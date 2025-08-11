#!/usr/bin/env python3
"""
local_prep.py

What it does (by default):
- Processes BOTH images and videos.
- Skips work when outputs already exist and are newer than the source.
- Rewrites index.html <picture> and <video> blocks idempotently.
- Makes a timestamped backup of the HTML before writing.

Flags you might care about:
  --only-images / --only-videos
  --force-images  (rebuild image variants even if up-to-date)
  --force-videos  (rebuild poster/webm even if up-to-date)
  --no-fallback-raster (don’t create JPEG/PNG resized fallbacks)
  --dry-run       (show what would happen)
"""

from __future__ import annotations
import argparse, os, re, shutil, subprocess, sys, time
from pathlib import Path
from typing import List, Dict, Optional

from PIL import Image
from bs4 import BeautifulSoup

# ---------------- Utilities ----------------

def log(msg: str): print(f"▶ {msg}")
def ok(msg: str): print(f"✅ {msg}")
def warn(msg: str): print(f"⚠️  {msg}")
def err(msg: str): print(f"❌ {msg}", file=sys.stderr)

def which(cmd: str) -> Optional[str]:
    return shutil.which(cmd)

def need(cmd: str):
    if not which(cmd):
        raise SystemExit(f"Required executable not found on PATH: {cmd}")

def run(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def ensure_parent(p: Path):
    p.parent.mkdir(parents=True, exist_ok=True)

def timestamp() -> str:
    return time.strftime("%Y%m%d-%H%M%S")

def backup_file(path: Path) -> Path:
    b = path.with_suffix(path.suffix + f".bak.{timestamp()}")
    shutil.copy2(path, b)
    return b

def relpath(child: Path, start: Path) -> str:
    return os.path.relpath(child.as_posix(), start.as_posix()).replace("\\", "/")

def is_raster(ext: str) -> bool:
    return ext.lower() in {".jpg", ".jpeg", ".png"}

def newer_than(src: Path, dest: Path) -> bool:
    """Return True if dest exists and is newer than src."""
    return dest.exists() and dest.stat().st_mtime > src.stat().st_mtime

# ---------------- Image ops ----------------

def pillow_resize(src: Path, out: Path, width: int, fmt: str, quality: int = 82, effort: int = 4):
    ensure_parent(out)
    with Image.open(src) as im:
        w, h = im.size
        if w <= width:
            new_w, new_h = w, h
        else:
            new_w = width
            new_h = int(round(h * (width / float(w))))
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        im = im.resize((new_w, new_h), Image.LANCZOS)

        fmt_lower = fmt.lower()
        if fmt_lower == "webp":
            im.save(out, format="WEBP", quality=quality, method=6)
        elif fmt_lower in ("jpg", "jpeg"):
            im.save(out, format="JPEG", quality=quality, optimize=True, progressive=True)
        elif fmt_lower == "png":
            im.save(out, format="PNG", optimize=True)
        elif fmt_lower == "avif":
            try:
                im.save(out, format="AVIF", quality=max(1, min(quality, 100)), effort=effort)
            except Exception:
                _encode_avif_ffmpeg(src, out, width)
        else:
            raise ValueError(f"Unsupported format: {fmt}")

def _encode_avif_ffmpeg(src: Path, out: Path, width: int, crf: int = 28, cpu_used: int = 6):
    need("ffmpeg")
    ensure_parent(out)
    vf = f"scale='min({width},iw)':'-2':flags=lanczos"
    cmd = [
        "ffmpeg","-y","-i",str(src),
        "-vf",vf,"-frames:v","1",
        "-c:v","libaom-av1","-still_picture","1",
        "-pix_fmt","yuv420p10le","-crf",str(crf),"-cpu-used",str(cpu_used),
        str(out)
    ]
    run(cmd)

def outputs_for_image(src: Path, width: int, want_fallback: bool) -> Dict[str, Path]:
    base = src.stem
    outs = {
        "webp": src.with_name(f"{base}-{width}.webp"),
        "avif": src.with_name(f"{base}-{width}.avif"),
    }
    if want_fallback and is_raster(src.suffix):
        fallback_ext = ".jpg" if src.suffix.lower() in {".jpg",".jpeg"} else ".png"
        outs["fallback"] = src.with_name(f"{base}-{width}{fallback_ext}")
    return outs

def any_image_output_stale(src: Path, outs: Dict[str, Path]) -> bool:
    """Return True if any output is missing or older than the source."""
    for p in outs.values():
        if not p.exists() or not newer_than(src, p):
            return True
    return False

def generate_responsive_images(images_dir: Path, widths: List[int], make_fallback: bool, force: bool, dry: bool) -> int:
    exts = {".jpg",".jpeg",".png",".webp",".avif"}
    touched_images = 0

    for src in sorted(images_dir.glob("*")):
        if not src.is_file() or src.suffix.lower() not in exts:
            continue
        try:
            with Image.open(src) as im:
                w0,_ = im.size
        except Exception:
            warn(f"Skipping unreadable image: {src}")
            continue

        did_any = False
        for w in widths:
            if w0 < w:  # no upscaling
                continue

            outs = outputs_for_image(src, w, want_fallback=make_fallback)
            if not force and not any_image_output_stale(src, outs):
                continue  # up-to-date

            if dry:
                log(f"[DRY] Would (re)generate: {', '.join(p.name for p in outs.values())}")
            else:
                pillow_resize(src, outs["webp"], w, "webp")
                pillow_resize(src, outs["avif"], w, "avif")
                if "fallback" in outs:
                    fmt = outs["fallback"].suffix.lstrip(".")
                    pillow_resize(src, outs["fallback"], w, fmt)
            did_any = True

        if did_any:
            touched_images += 1
        else:
            log(f"Skip (already up-to-date): {src.name}")

    return touched_images

# ---------------- Video ops ----------------

def probe_duration(path: Path) -> float:
    need("ffprobe")
    cmd = ["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(path)]
    try:
        out = run(cmd).stdout.decode().strip()
        return float(out)
    except Exception:
        return 0.0

def extract_poster(mp4: Path, out_jpg: Path, at_seconds: float):
    need("ffmpeg")
    ensure_parent(out_jpg)
    cmd = ["ffmpeg","-y","-ss",f"{at_seconds:.3f}","-i",str(mp4),"-frames:v","1","-q:v","2",str(out_jpg)]
    run(cmd)

def encode_webm_av1(mp4: Path, out_webm: Path, crf: int = 30, cpu_used: int = 4, audio_bitrate: str = "128k"):
    need("ffmpeg")
    ensure_parent(out_webm)
    cmd = [
        "ffmpeg","-y","-i",str(mp4),
        "-c:v","libaom-av1","-crf",str(crf),"-b:v","0","-cpu-used",str(cpu_used),"-row-mt","1",
        "-c:a","libopus","-b:a",audio_bitrate,
        "-map_metadata","-1",
        str(out_webm)
    ]
    run(cmd)

def video_outputs_for(mp4: Path) -> Dict[str, Path]:
    base = mp4.stem
    return {
        "poster": mp4.with_name(f"{base}.jpg"),
        "webm": mp4.with_name(f"{base}.webm"),
    }

def any_video_output_stale(mp4: Path, outs: Dict[str, Path]) -> bool:
    """True if any required output is missing or older than the mp4."""
    required = ["poster", "webm"]
    for k in required:
        p = outs[k]
        if not p.exists() or not newer_than(mp4, p):
            return True
    return False

def process_videos(media_dir: Path, force: bool, dry: bool) -> int:
    touched = 0
    for mp4 in sorted(media_dir.glob("video*.mp4")):
        outs = video_outputs_for(mp4)
        stale = any_video_output_stale(mp4, outs)

        if not force and not stale:
            log(f"Skip (already up-to-date): {mp4.name}")
            continue

        dur = probe_duration(mp4)
        t = max(1.0, dur * 0.10 if dur > 0 else 1.0)

        if dry:
            if not newer_than(mp4, outs["poster"]):
                log(f"[DRY] Would extract poster {outs['poster'].name} @ {t:.2f}s")
            if not newer_than(mp4, outs["webm"]):
                log(f"[DRY] Would encode {outs['webm'].name} from {mp4.name}")
        else:
            if not outs["poster"].exists() or not newer_than(mp4, outs["poster"]):
                extract_poster(mp4, outs["poster"], t)
            if not outs["webm"].exists() or not newer_than(mp4, outs["webm"]):
                encode_webm_av1(mp4, outs["webm"])
        touched += 1
    return touched

# ---------------- HTML rewrite ----------------

def gather_generated(images_dir: Path, base: str) -> Dict[str,List[Path]]:
    out = {"webp":[], "avif":[], "fallback":[]}
    for p in sorted(images_dir.glob(f"{base}-*.webp")): out["webp"].append(p)
    for p in sorted(images_dir.glob(f"{base}-*.avif")): out["avif"].append(p)
    for ext in (".jpg",".jpeg",".png"):
        out["fallback"].extend(sorted(images_dir.glob(f"{base}-*{ext}")))
    return out

def build_srcset(paths: List[Path], html_dir: Path) -> str:
    parts = []
    for p in sorted(paths, key=lambda x: x.name):
        m = re.search(r"-(\d+)\.(?:webp|avif|jpe?g|png)$", p.name)
        width = (m.group(1) + "w") if m else ""
        parts.append(f"{relpath(p, html_dir)} {width}".strip())
    return ", ".join(parts)

def pick_fallback(bundles: Dict[str,List[Path]], target_w: int, html_dir: Path, default_src: str) -> str:
    if not bundles["fallback"]:
        return default_src
    pick = None
    for p in bundles["fallback"]:
        m = re.search(r"-(\d+)\.", p.name)
        if m and int(m.group(1)) == target_w:
            pick = p; break
    if not pick: pick = bundles["fallback"][0]
    return relpath(pick, html_dir)

def wrap_img_to_picture(soup, img, avif_srcset, webp_srcset, fallback_src, sizes_val):
    picture = soup.new_tag("picture")
    attrs = {k:v for k,v in img.attrs.items() if k not in ("src","srcset","sizes")}
    s1 = soup.new_tag("source", **{"type":"image/avif"}); s1["srcset"] = avif_srcset
    s2 = soup.new_tag("source", **{"type":"image/webp"}); s2["srcset"] = webp_srcset
    new_img = soup.new_tag("img", **attrs)
    new_img["src"] = fallback_src
    new_img["srcset"] = webp_srcset
    new_img["sizes"] = sizes_val
    if "loading" not in new_img.attrs: new_img["loading"] = "lazy"
    if "decoding" not in new_img.attrs: new_img["decoding"] = "async"
    picture.append(s1); picture.append(s2); picture.append(new_img)
    img.replace_with(picture)

def update_picture_block(soup, picture, avif_srcset, webp_srcset, fallback_src, sizes_val):
    s_avif = None; s_webp = None
    for s in picture.find_all("source"):
        if s.get("type") == "image/avif": s_avif = s
        if s.get("type") == "image/webp": s_webp = s
    if not s_avif:
        s_avif = soup.new_tag("source", **{"type":"image/avif"})
        picture.insert(0, s_avif)
    s_avif["srcset"] = avif_srcset
    if not s_webp:
        s_webp = soup.new_tag("source", **{"type":"image/webp"})
        picture.insert(1, s_webp)
    s_webp["srcset"] = webp_srcset
    img = picture.find("img") or soup.new_tag("img")
    img["src"] = fallback_src
    img["sizes"] = sizes_val
    if "loading" not in img.attrs: img["loading"] = "lazy"
    if "decoding" not in img.attrs: img["decoding"] = "async"
    if not picture.find("img"): picture.append(img)

def process_html_images(html_file: Path, images_dir: Path, sizes_val: str, widths: List[int], dry: bool):
    soup = BeautifulSoup(html_file.read_text(encoding="utf-8"), "lxml")
    html_dir = html_file.parent
    changed = False

    # Pass 1: plain <img> not inside <picture>
    for img in list(soup.find_all("img")):
        if img.find_parent("picture"): continue
        src = img.get("src") or img.get("data-src") or ""
        if "assets/images/" not in src: continue
        base = Path(src).stem
        bundles = gather_generated(images_dir, base)
        if not bundles["webp"] or not bundles["avif"]: continue

        avif_srcset = build_srcset(bundles["avif"], html_dir)
        webp_srcset = build_srcset(bundles["webp"], html_dir)
        fallback_src = pick_fallback(bundles, target_w=800, html_dir=html_dir, default_src=src)
        sizes_attr = img.get("sizes") or sizes_val

        if dry:
            log(f"[DRY] Would wrap <img src='{src}'> into <picture>")
        else:
            wrap_img_to_picture(soup, img, avif_srcset, webp_srcset, fallback_src, sizes_attr)
            changed = True

    # Pass 2: existing <picture>
    for picture in list(soup.find_all("picture")):
        img = picture.find("img")
        if not img: continue
        src = img.get("src") or img.get("data-src") or ""
        if "assets/images/" not in src: continue
        base = Path(src).stem.split("-")[0]  # handle image-800.jpg
        bundles = gather_generated(images_dir, base)
        if not bundles["webp"] or not bundles["avif"]: continue

        avif_srcset = build_srcset(bundles["avif"], html_dir)
        webp_srcset = build_srcset(bundles["webp"], html_dir)
        fallback_src = pick_fallback(bundles, target_w=800, html_dir=html_dir, default_src=src)
        sizes_attr = img.get("sizes") or sizes_val

        if dry:
            log(f"[DRY] Would update <picture> for base '{base}'")
        else:
            update_picture_block(soup, picture, avif_srcset, webp_srcset, fallback_src, sizes_attr)
            changed = True

    if changed and not dry:
        b = backup_file(html_file)
        log(f"Backed up HTML to {b.name}")
        html_file.write_text(soup.prettify(formatter="html5"), encoding="utf-8")
        ok(f"Updated HTML images in {html_file.name}")
    elif not changed:
        log("No image HTML changes needed.")

def process_html_videos(html_file: Path, media_dir: Path, dry: bool):
    soup = BeautifulSoup(html_file.read_text(encoding="utf-8"), "lxml")
    html_dir = html_file.parent
    changed = False

    for vid in list(soup.find_all("video")):
        base = None

        direct = vid.get("src") or vid.get("data-src") or ""
        m = re.search(r"assets/media/(video\d+)\.mp4$", direct)
        if m: base = m.group(1)
        if not base:
            for s in vid.find_all("source"):
                ssrc = s.get("src") or s.get("data-src") or ""
                m = re.search(r"assets/media/(video\d+)\.mp4$", ssrc)
                if m: base = m.group(1); break
        if not base:
            continue

        mp4 = media_dir / f"{base}.mp4"
        webm = media_dir / f"{base}.webm"
        poster = media_dir / f"{base}.jpg"

        if "src" in vid.attrs:
            del vid.attrs["src"]
        if poster.exists():
            vid["poster"] = relpath(poster, html_dir)
        vid["preload"] = vid.get("preload") or "none"

        for s in vid.find_all("source"): s.decompose()
        s_webm = soup.new_tag("source"); s_webm["type"] = "video/webm"
        s_mp4  = soup.new_tag("source"); s_mp4["type"]  = "video/mp4"
        s_webm["data-src"] = relpath(webm, html_dir) if webm.exists() else f"assets/media/{base}.webm"
        s_mp4["data-src"]  = relpath(mp4,  html_dir) if mp4.exists()  else f"assets/media/{base}.mp4"
        vid.append(s_webm); vid.append(s_mp4)

        changed = True

    if changed and not dry:
        b = backup_file(html_file)
        log(f"Backed up HTML to {b.name}")
        html_file.write_text(soup.prettify(formatter="html5"), encoding="utf-8")
        ok(f"Updated HTML videos in {html_file.name}")
    elif not changed:
        log("No video HTML changes needed.")

# ---------------- CLI ----------------

def main():
    p = argparse.ArgumentParser(description="Local media prep: responsive images, posters/webm, HTML rewrite.")
    p.add_argument("--html", default="index.html", help="HTML file to rewrite (default: index.html)")
    p.add_argument("--images-dir", default="assets/images", help="Directory of images")
    p.add_argument("--media-dir", default="assets/media", help="Directory of videos")
    p.add_argument("--widths", nargs="+", type=int, default=[480,800,1080], help="Widths for responsive images")
    p.add_argument("--sizes", default="(min-width:1200px) 33vw, (min-width:768px) 50vw, 100vw", help="sizes= attribute value")
    p.add_argument("--only-images", action="store_true", help="Process only images (+ HTML).")
    p.add_argument("--only-videos", action="store_true", help="Process only videos (+ HTML).")
    p.add_argument("--force-images", action="store_true", help="Force-regenerate image variants even if up-to-date.")
    p.add_argument("--force-videos", action="store_true", help="Force-regenerate poster/webm even if up-to-date.")
    p.add_argument("--no-fallback-raster", action="store_true", help="Skip JPEG/PNG fallbacks for images.")
    p.add_argument("--dry-run", action="store_true", help="Show actions without writing files.")
    args = p.parse_args()

    html  = Path(args.html).resolve()
    images = Path(args.images_dir).resolve()
    media  = Path(args.media_dir).resolve()

    if not html.exists():
        err(f"HTML not found: {html}")
        sys.exit(1)
    if not images.exists():
        err(f"Images dir not found: {images}")
        sys.exit(1)
    if not media.exists():
        warn(f"Media dir not found; creating: {media}")
        if not args.dry_run:
            media.mkdir(parents=True, exist_ok=True)

    # Preflight for video tools only if we're processing videos
    do_images = not args.only_videos
    do_videos = not args.only_images
    if do_videos:
        for exe in ("ffmpeg","ffprobe"):
            if not which(exe):
                err(f"{exe} not found on PATH but video processing is enabled.")
                sys.exit(1)

    # Images
    if do_images:
        log("Processing images…")
        generate_responsive_images(
            images, args.widths,
            make_fallback=not args.no_fallback_raster,
            force=args.force_images,
            dry=args.dry_run
        )
        process_html_images(html, images, args.sizes, args.widths, dry=args.dry_run)

    # Videos
    if do_videos:
        log("Processing videos…")
        process_videos(media, force=args.force_videos, dry=args.dry_run)
        process_html_videos(html, media, dry=args.dry_run)

    ok("Done.")

if __name__ == "__main__":
    main()

#!/usr/bin/env bash
set -euo pipefail

# =========================
# prepare_assets.sh (v2)
# - Converts images → AVIF (keeps originals/WebP)
# - Creates smaller "grid_" MP4s for the work grid
# - Emits images.csv (filename,width,height)
# - Optionally merges slugs from a CSV OR generates slugs
# - Optionally renames files to slug (dry-run by default)
# =========================
# Usage examples:
#   ./tools/prepare_assets.sh assets
#   ./tools/prepare_assets.sh assets --slugs tools/images_with_descriptive_slugs.csv
#   ./tools/prepare_assets.sh assets --gen-slugs sequential --prefix visual- --start 1 --pad 3
#   ./tools/prepare_assets.sh assets --gen-slugs filename --prefix visual-
#   ./tools/prepare_assets.sh assets --slugs tools/images_with_descriptive_slugs.csv --rename
# =========================

ROOT_DIR="${1:-.}"

# ---- options ----
SLUG_CSV=""                # path to CSV that has columns: filename,slug  (width/height/others ignored)
GEN_SLUGS=""               # "sequential" | "filename" | "" (off)
SLUG_PREFIX="visual-"
SLUG_START=1
SLUG_PAD=3
DO_RENAME=false            # rename image files on disk to <slug>.<ext> (safe-ish)
DRY_RUN=true               # show what would be renamed unless --rename-confirm
RENAME_CONFIRM=false

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --slugs) SLUG_CSV="${2?}"; shift 2;;
    --gen-slugs) GEN_SLUGS="${2?}"; shift 2;;
    --prefix) SLUG_PREFIX="${2?}"; shift 2;;
    --start) SLUG_START="${2?}"; shift 2;;
    --pad) SLUG_PAD="${2?}"; shift 2;;
    --rename) DO_RENAME=true; shift;;
    --rename-confirm) RENAME_CONFIRM=true; DRY_RUN=false; DO_RENAME=true; shift;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

IMG_EXTS="jpg jpeg png webp avif"
VIDEO_EXTS="mp4 mov m4v"
GRID_MAX_W=800
GRID_FPS=24
H265_GRID=false

IMG_CSV="${ROOT_DIR%/}/images.csv"
IMG_SLUGS_OUT="${ROOT_DIR%/}/images_with_slugs.csv"
VID_CSV="${ROOT_DIR%/}/videos.csv"

have() { command -v "$1" >/dev/null 2>&1; }

need_tools=()
have identify || have magick || need_tools+=("ImageMagick (identify)")
have ffmpeg   || need_tools+=("ffmpeg")
have ffprobe  || need_tools+=("ffprobe")
if ((${#need_tools[@]})); then
  echo "Missing required tools:"; printf '  - %s\n' "${need_tools[@]}"
  echo "macOS (Homebrew):  brew install imagemagick ffmpeg"
  exit 1
fi
USE_AVIFENC=false; have avifenc && USE_AVIFENC=true

# --- helpers ---
img_dims(){ identify -format "%w,%h" "$1" 2>/dev/null || magick identify -format "%w,%h" "$1"; }
video_dims(){ ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=, "$1"; }

# --- CSV headers ---
echo "filename,width,height" > "$IMG_CSV"
echo "filename,width,height" > "$VID_CSV"

echo "[step] Images → AVIF + measure…"
while IFS= read -r -d '' f; do
  dims="$(img_dims "$f" || true)"
  [[ -n "$dims" ]] && echo "${f#$ROOT_DIR/},$dims" >> "$IMG_CSV" || echo "[warn] no dims: $f"

  # skip if already avif
  ext="${f##*.}"; ext="${ext,,}"
  avif_out="${f%.*}.avif"
  if [[ "$ext" != "avif" && ! -f "$avif_out" ]]; then
    if $USE_AVIFENC; then
      avifenc --min 28 --max 32 --speed 6 --jobs 8 "$f" "$avif_out" >/dev/null 2>&1 || true
    else
      ffmpeg -v error -y -i "$f" -c:v libaom-av1 -still-picture 1 -crf 32 -b:v 0 "$avif_out" || true
    fi
    echo "[ok] avif: ${avif_out#$ROOT_DIR/}"
  fi
done < <(find "$ROOT_DIR" -type f \( $(printf -- '-iname "*.%s" -o ' $IMG_EXTS | sed 's/ -o $//') \) -print0)

echo "[step] Videos → grid_* (faststart, scaled)…"
codec_v="libx264"; [[ "$H265_GRID" == "true" ]] && codec_v="libx265"
while IFS= read -r -d '' f; do
  echo "${f#$ROOT_DIR/},$(video_dims "$f" || echo '','')" >> "$VID_CSV"
  base="$(basename "$f")"; dir="$(dirname "$f")"
  grid_out="$dir/grid_$base"
  [[ -f "$grid_out" ]] && { echo "[skip] exists: ${grid_out#$ROOT_DIR/}"; continue; }
  ffmpeg -v error -y -i "$f" \
    -vf "scale='if(gt(iw,$GRID_MAX_W),$GRID_MAX_W,iw)':-2" \
    -r "$GRID_FPS" -c:v "$codec_v" -crf 23 -preset slow -pix_fmt yuv420p \
    -movflags +faststart -an "$grid_out"
  echo "[ok] grid: ${grid_out#$ROOT_DIR/}"
done < <(find "$ROOT_DIR" -type f \( $(printf -- '-iname "*.%s" -o ' $VIDEO_EXTS | sed 's/ -o $//') \) -print0)

# ---- Slug merging / generation ----
# We’ll create images_with_slugs.csv with columns: filename,width,height,slug[,title]
# If --slugs path given: use slug from that CSV (by filename match).
# Else if --gen-slugs set: generate sequential or filename-based.

echo "[step] Slugs → ${IMG_SLUGS_OUT#$ROOT_DIR/}"

python3 - "$ROOT_DIR" "$IMG_CSV" "$IMG_SLUGS_OUT" "$SLUG_CSV" "$GEN_SLUGS" "$SLUG_PREFIX" "$SLUG_START" "$SLUG_PAD" <<'PY'
import sys, csv, os, re
root, img_csv, out_csv, slug_csv, mode, prefix, start, pad = sys.argv[1:]
start, pad = int(start), int(pad)

# read dimensions
rows = []
with open(img_csv, newline='') as f:
    for r in csv.DictReader(f):
        rows.append({"filename": r["filename"], "width": r["width"], "height": r["height"]})

# helper: slugify from filename
def slugify(name: str):
    base = os.path.splitext(os.path.basename(name))[0]
    s = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()
    return re.sub(r"-{2,}", "-", s)

# load provided slugs if any
slug_map = {}
title_map = {}
if slug_csv:
    with open(slug_csv, newline='') as f:
        rdr = csv.DictReader(f)
        cols = [c.lower() for c in rdr.fieldnames]
        # accept columns: filename, slug, title (title optional)
        for r in rdr:
            fname = r.get("filename") or r.get("file") or r.get("name")
            slug  = r.get("slug")
            title = r.get("title") or ""
            if fname and slug:
                slug_map[os.path.basename(fname)] = slug
                title_map[os.path.basename(fname)] = title

seen = set()
def dedupe(s):
    t = s
    i = 2
    while t in seen:
        t = f"{s}-{i}"
        i += 1
    seen.add(t)
    return t

n = start
for r in rows:
    fn = os.path.basename(r["filename"])
    slug = ""
    title = ""
    if slug_map:
        slug = slug_map.get(fn, "")
        title = title_map.get(fn, "")
    if not slug and mode == "sequential":
        slug = f"{prefix}{str(n).zfill(pad)}"; n += 1
    elif not slug and mode == "filename":
        core = slugify(fn)
        slug = f"{prefix}{core}" if prefix else core
    elif not slug:
        # default to filename if no mode/slug provided
        core = slugify(fn)
        slug = f"{prefix}{core}" if prefix else core
    slug = dedupe(slug)
    r["slug"] = slug
    r["title"] = title

with open(out_csv, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["filename","width","height","slug","title"])
    w.writeheader()
    w.writerows(rows)
print(f"[ok] wrote {out_csv}")
PY

# ---- Optional rename to slug ----
if $DO_RENAME; then
  echo "[step] Rename images to slug (keep extension) — DRY_RUN=$DRY_RUN"
  python3 - "$ROOT_DIR" "$IMG_SLUGS_OUT" "$DRY_RUN" "$RENAME_CONFIRM" <<'PY'
import sys, csv, os, shutil
root, csv_path, dry_run, confirm = sys.argv[1], sys.argv[2], sys.argv[3]=="True", sys.argv[4]=="True"
moves = []
with open(csv_path, newline='') as f:
    for r in csv.DictReader(f):
        src = os.path.join(root, r["filename"])
        if not os.path.isfile(src): 
            # best-effort find by basename anywhere under root
            found = None
            for dp,_,files in os.walk(root):
                if os.path.basename(src) in files:
                    found = os.path.join(dp, os.path.basename(src)); break
            if not found: 
                print(f"[miss] {src}"); continue
            src = found
        base, ext = os.path.splitext(src)
        dst = os.path.join(os.path.dirname(src), f'{r["slug"]}{ext}')
        if os.path.abspath(src) == os.path.abspath(dst): 
            continue
        moves.append((src, dst))

print(f"[plan] {len(moves)} rename(s)")
for src, dst in moves:
    print(f"  {os.path.relpath(src, root)} -> {os.path.relpath(dst, root)}")

if not dry_run and confirm:
    # avoid clobber
    for src, dst in moves:
        if os.path.exists(dst):
            base, ext = os.path.splitext(dst)
            i = 2
            ndst = f"{base}-{i}{ext}"
            while os.path.exists(ndst):
                i += 1; ndst = f"{base}-{i}{ext}"
            dst = ndst
        shutil.move(src, dst)
    print("[ok] renamed files")
else:
    print("[note] dry run only. Use --rename-confirm to actually rename.")
PY
fi

echo "[done]"

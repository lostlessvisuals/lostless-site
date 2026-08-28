#!/usr/bin/env python3
"""Fast, dependency-free smoke checks for the static lostless site."""

from __future__ import annotations

import json
import struct
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent.parent
SKIP_PARTS = {".git", "drafts", "includes"}


class SiteParser(HTMLParser):
    def __init__(self, source: Path) -> None:
        super().__init__()
        self.source = source
        self.refs: list[str] = []
        self.videos: list[dict[str, str]] = []
        self.iframes: list[dict[str, str]] = []
        self._video_sources: list[dict[str, str]] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        for key in ("href", "src", "poster", "data-poster", "data-src"):
            if values.get(key):
                self.refs.append(values[key])
        for item in values.get("srcset", "").split(","):
            if item.strip():
                self.refs.append(item.strip().split()[0])

        if tag == "video":
            self.videos.append({**values, "sources": ""})
            self._video_sources = []
        elif tag == "iframe":
            self.iframes.append(values)
        elif tag == "source" and self._video_sources is not None:
            self._video_sources.append(values)
            self.videos[-1]["sources"] = json.dumps(self._video_sources)

    def handle_endtag(self, tag: str) -> None:
        if tag == "video":
            self._video_sources = None


def public_html_files() -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob("*.html")
        if not SKIP_PARTS.intersection(path.relative_to(ROOT).parts)
    )


def local_target(source: Path, raw_url: str) -> Path | None:
    if not raw_url or raw_url.startswith(("#", "mailto:", "tel:", "data:", "javascript:")):
        return None
    parsed = urlparse(raw_url)
    if parsed.scheme or parsed.netloc:
        return None
    url_path = unquote(parsed.path)
    target = ROOT / url_path.lstrip("/") if url_path.startswith("/") else source.parent / url_path
    if url_path.endswith("/"):
        target /= "index.html"
    return target.resolve()


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:24]
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    return struct.unpack(">II", data[16:24])


def main() -> int:
    errors: list[str] = []
    references = 0
    homepage_videos: list[dict[str, str]] = []
    highlight_iframes: list[dict[str, str]] = []

    for html_file in public_html_files():
        parser = SiteParser(html_file)
        parser.feed(html_file.read_text(encoding="utf-8"))
        references += len(parser.refs)
        if html_file == ROOT / "index.html":
            homepage_videos = parser.videos
        elif html_file == ROOT / "highlights/index.html":
            highlight_iframes = parser.iframes
        for ref in parser.refs:
            target = local_target(html_file, ref)
            if target is not None and not target.exists():
                errors.append(f"missing local reference: {html_file.relative_to(ROOT)} -> {ref}")

    for index, video in enumerate(homepage_videos, start=1):
        sources = json.loads(video.get("sources", "[]"))
        source_types = {source.get("type") for source in sources}
        if video.get("poster"):
            errors.append(f"video {index} eagerly loads poster={video['poster']}")
        if not video.get("data-poster"):
            errors.append(f"video {index} is missing data-poster")
        if not video.get("aria-label"):
            errors.append(f"video {index} is missing aria-label")
        if video.get("preload") != "none":
            errors.append(f"video {index} must use preload=none")
        if source_types != {"video/mp4", "video/webm"}:
            errors.append(f"video {index} must provide MP4 and WebM sources")
        if any(not source.get("data-src") for source in sources):
            errors.append(f"video {index} has an eager or empty source")

    expected_pngs = {
        "assets/favicon/favicon-16x16.png": (16, 16),
        "assets/favicon/favicon-32x32.png": (32, 32),
        "assets/favicon/apple-touch-icon.png": (180, 180),
        "assets/favicon/icon-192x192.png": (192, 192),
        "assets/favicon/icon-512x512.png": (512, 512),
    }
    for relative, expected in expected_pngs.items():
        path = ROOT / relative
        try:
            actual = png_dimensions(path)
        except (OSError, ValueError, struct.error) as exc:
            errors.append(f"invalid icon {relative}: {exc}")
        else:
            if actual != expected:
                errors.append(f"wrong icon size {relative}: {actual}, expected {expected}")

    ico = (ROOT / "favicon.ico").read_bytes()[:4]
    if ico != b"\x00\x00\x01\x00":
        errors.append("favicon.ico is not a valid ICO container")

    manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    manifest_sizes = {icon.get("sizes") for icon in manifest.get("icons", [])}
    if not {"192x192", "512x512"}.issubset(manifest_sizes):
        errors.append("manifest must declare 192x192 and 512x512 icons")

    sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    if "https://lostless.live/boring-nodes/" not in sitemap:
        errors.append("sitemap omits /boring-nodes/")

    for index, iframe in enumerate(highlight_iframes, start=1):
        if iframe.get("loading") != "lazy":
            errors.append(f"highlight iframe {index} must use loading=lazy")
        if not iframe.get("title"):
            errors.append(f"highlight iframe {index} is missing a title")

    homepage_js = (ROOT / "assets/js/homepage-media.js").read_text(encoding="utf-8")
    if "prefers-reduced-motion: reduce" not in homepage_js:
        errors.append("homepage videos do not respect reduced-motion preferences")

    homepage_html = (ROOT / "index.html").read_text(encoding="utf-8")
    if "media.getAttribute('src').split" in homepage_html:
        errors.append("homepage media click handler can split a missing src attribute")

    commands = (
        (["node", "--check", "assets/js/homepage-media.js"], "homepage JavaScript"),
        (["bash", "-n", "assets/strip_metadata.sh"], "metadata shell script"),
    )
    for command, label in commands:
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
        if result.returncode:
            errors.append(f"invalid {label}: {result.stderr.strip()}")

    if errors:
        print("SITE SMOKE FAILED", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        f"SITE SMOKE PASSED: {len(public_html_files())} pages, "
        f"{references} references, {len(homepage_videos)} lazy videos"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

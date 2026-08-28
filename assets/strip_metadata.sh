#!/usr/bin/env bash
set -euo pipefail

ASSETS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Videos in media/ (mp4, webm) – lossless, metadata only
find "$ASSETS_DIR/media" -type f \( -iname "*.mp4" -o -iname "*.webm" \) -print0 | \
while IFS= read -r -d '' f; do
  tmp="${f%.*}.tmp.${f##*.}"
  ffmpeg -y -i "$f" -map_metadata -1 -c copy "$tmp"
  mv "$tmp" "$f"
done

# JPEGs in media/ – reencode to strip EXIF
find "$ASSETS_DIR/media" -type f \( -iname "*.jpg" -o -iname "*.jpeg" \) -print0 | \
while IFS= read -r -d '' f; do
  tmp="${f%.*}.tmp.jpg"
  ffmpeg -y -i "$f" -map_metadata -1 -c:v mjpeg -q:v 2 "$tmp"
  mv "$tmp" "$f"
done

# WebP in images/ – metadata only, no reencode
find "$ASSETS_DIR/images" -type f -iname "*.webp" -print0 | \
while IFS= read -r -d '' f; do
  tmp="${f%.*}.tmp.webp"
  ffmpeg -y -i "$f" -map_metadata -1 -c copy "$tmp"
  mv "$tmp" "$f"
done

# AVIF in images/ – metadata only, no reencode
find "$ASSETS_DIR/images" -type f -iname "*.avif" -print0 | \
while IFS= read -r -d '' f; do
  tmp="${f%.*}.tmp.avif"
  ffmpeg -y -i "$f" -map_metadata -1 -c copy "$tmp"
  mv "$tmp" "$f"
done

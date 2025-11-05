#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob nocaseglob

# USAGE:
#   bash make_video_assets.sh [SRC_DIR] [START_INDEX]
# EXAMPLE:
#   bash make_video_assets.sh ./vid 36

SRC_DIR="${1:-./vid}"
START_INDEX_IN="${2:-36}"

OUT_DIR="assets/media"
mkdir -p "$OUT_DIR"

# --- require ffmpeg ---
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install it (e.g., brew install ffmpeg)"; exit 1
fi

# --- find highest existing index so we don't overwrite ---
max_existing=0
for f in "$OUT_DIR"/video*.mp4; do
  [ -e "$f" ] || continue
  base="${f##*/}"        # video12.mp4
  num="${base#video}"    # 12.mp4
  num="${num%.mp4}"      # 12
  [[ "$num" =~ ^[0-9]+$ ]] && (( num > max_existing )) && max_existing="$num"
done

# --- normalize start index (auto-bump if <= existing) ---
if ! [[ "$START_INDEX_IN" =~ ^[0-9]+$ ]]; then
  echo "START_INDEX must be a number (got '$START_INDEX_IN')"; exit 1
fi
START_INDEX="$START_INDEX_IN"
if (( START_INDEX <= max_existing )); then
  START_INDEX=$((max_existing + 1))
  echo "Note: existing max index is $max_existing. Bumping start to $START_INDEX."
fi

# --- collect source files from SRC_DIR (portable, no mapfile) ---
FILES=(
  "$SRC_DIR"/*.mp4
  "$SRC_DIR"/*.MP4
  "$SRC_DIR"/*.mov
  "$SRC_DIR"/*.MOV
  "$SRC_DIR"/*.mkv
  "$SRC_DIR"/*.MKV
  "$SRC_DIR"/*.webm
  "$SRC_DIR"/*.WEBM
  "$SRC_DIR"/*.m4v
  "$SRC_DIR"/*.M4V
)
# Remove any non-existent globs (nullglob handles this), sort for stability
IFS=$'\n' FILES=( $(printf '%s\n' "${FILES[@]}" | sed '/^\s*$/d' | sort) )
unset IFS

if [ ${#FILES[@]} -eq 0 ]; then
  echo "No video files found in: $SRC_DIR"; exit 1
fi

idx="$START_INDEX"
for invid in "${FILES[@]}"; do
  mp4="$OUT_DIR/video${idx}.mp4"
  webm="$OUT_DIR/video${idx}.webm"
  jpg="$OUT_DIR/video${idx}.jpg"

  echo ">>> #$idx  $(basename "$invid")"

  # 1) MP4 (H.264), long side ≤ 1080, even dims, faststart, no audio (autoplay-friendly)
  if [[ ! -f "$mp4" ]]; then
    ffmpeg -y -i "$invid" \
      -vf "scale=trunc(iw*min(1080/iw\,1080/ih)/2)*2:trunc(ih*min(1080/iw\,1080/ih)/2)*2,setsar=1" \
      -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -movflags +faststart -an \
      "$mp4"
  else
    echo "    (skip) $mp4 exists"
  fi

  # 2) WebM (VP9), no audio
  if [[ ! -f "$webm" ]]; then
    ffmpeg -y -i "$mp4" \
      -c:v libvpx-vp9 -crf 33 -b:v 0 -row-mt 1 -pix_fmt yuv420p -an \
      -deadline good -tile-columns 2 -g 240 \
      "$webm"
  else
    echo "    (skip) $webm exists"
  fi

  # 3) Poster JPG (representative frame), up to 1600px wide
  if [[ ! -f "$jpg" ]]; then
    ffmpeg -y -i "$mp4" \
      -vf "thumbnail=60,scale='min(1600,iw)':-2" -frames:v 1 \
      -q:v 2 "$jpg"
  else
    echo "    (skip) $jpg exists"
  fi

  echo "    -> $mp4"
  echo "    -> $webm"
  echo "    -> $jpg"

  idx=$((idx+1))
done

echo "Done. Last index used: $((idx-1)). Next would be: $idx"

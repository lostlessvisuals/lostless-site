#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob           # don't expand to literal patterns
# IMPORTANT: do NOT enable nocaseglob (it causes duplicates on macOS)

# USAGE:
#   bash make_image_assets.sh [SRC_DIR] [START_INDEX]
# EXAMPLE:
#   bash make_image_assets.sh ./img 36
#
# INPUT   : ./img/*.jpg|jpeg|png|webp|avif|tif|tiff (any mix of cases)
# OUTPUTS : assets/images/
#           imageN.avif, imageN.webp,
#           imageN-480.avif/webp, imageN-800.avif/webp, imageN-1080.avif/webp

SRC_DIR="${1:-./img}"
START_INDEX_IN="${2:-36}"
OUT_DIR="assets/images"

BASE_MAX=1600
SIZES=(480 800 1080)

mkdir -p "$OUT_DIR"

# --- ffmpeg required ---
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install it (e.g., brew install ffmpeg)"; exit 1
fi

# --- codec availability ---
HAS_AVIF=0
HAS_WEBP=0
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q "libaom-av1"; then HAS_AVIF=1; fi
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q "libwebp";     then HAS_WEBP=1; fi
if (( HAS_AVIF == 0 && HAS_WEBP == 0 )); then
  echo "Neither AVIF (libaom-av1) nor WEBP (libwebp) encoders found in ffmpeg."; exit 1
fi
(( HAS_AVIF == 0 )) && echo "Note: libaom-av1 not found → skipping AVIF outputs."
(( HAS_WEBP == 0 )) && echo "Note: libwebp not found → skipping WEBP outputs."

# --- find highest existing index so we don't overwrite ---
max_existing=0
for f in "$OUT_DIR"/image*.avif "$OUT_DIR"/image*.webp; do
  [ -e "$f" ] || continue
  base="${f##*/}"            # image12.avif or image12-480.webp
  base="${base#image}"       # 12.avif or 12-480.webp
  base="${base%%-*}"         # 12
  base="${base%%.*}"         # 12
  [[ "$base" =~ ^[0-9]+$ ]] && (( base > max_existing )) && max_existing="$base"
done

# --- normalize start index ---
if ! [[ "$START_INDEX_IN" =~ ^[0-9]+$ ]]; then
  echo "START_INDEX must be a number (got '$START_INDEX_IN')"; exit 1
fi
START_INDEX="$START_INDEX_IN"
if (( START_INDEX <= max_existing )); then
  START_INDEX=$((max_existing + 1))
  echo "Note: existing max index is $max_existing. Bumping start to $START_INDEX."
fi

# --- collect source stills (case-aware patterns, then dedup) ---
FILES=(
  "$SRC_DIR"/*.jpg "$SRC_DIR"/*.JPG
  "$SRC_DIR"/*.jpeg "$SRC_DIR"/*.JPEG
  "$SRC_DIR"/*.png "$SRC_DIR"/*.PNG
  "$SRC_DIR"/*.webp "$SRC_DIR"/*.WEBP
  "$SRC_DIR"/*.avif "$SRC_DIR"/*.AVIF
  "$SRC_DIR"/*.tif "$SRC_DIR"/*.TIF
  "$SRC_DIR"/*.tiff "$SRC_DIR"/*.TIFF
)
# prune non-existent, sort, then deduplicate
IFS=$'\n' FILES=( $(printf '%s\n' "${FILES[@]}" | sed '/^\s*$/d' | sort -u) )
unset IFS

if [ ${#FILES[@]} -eq 0 ]; then
  echo "No images found in: $SRC_DIR"; exit 1
fi

scale_filter_for_width () {
  local W="$1"
  printf "scale='min(%d,iw)':-2" "$W"   # downscale only, keep AR
}

idx="$START_INDEX"
for inimg in "${FILES[@]}"; do
  base_no_suffix="$OUT_DIR/image${idx}"
  echo ">>> #$idx  $(basename "$inimg")"

  # Base (no suffix) — AVIF / WEBP at BASE_MAX width
  if (( HAS_AVIF )); then
    out_avif="${base_no_suffix}.avif"
    if [[ ! -f "$out_avif" ]]; then
      ffmpeg -y -i "$inimg" \
        -vf "$(scale_filter_for_width "$BASE_MAX")" -frames:v 1 \
        -c:v libaom-av1 -still-picture 1 -cpu-used 6 -crf 30 -b:v 0 \
        "$out_avif"
    else echo "    (skip) $out_avif exists"; fi
  fi

  if (( HAS_WEBP )); then
    out_webp="${base_no_suffix}.webp"
    if [[ ! -f "$out_webp" ]]; then
      ffmpeg -y -i "$inimg" \
        -vf "$(scale_filter_for_width "$BASE_MAX")" -frames:v 1 \
        -c:v libwebp -lossless 0 -q:v 82 \
        "$out_webp"
    else echo "    (skip) $out_webp exists"; fi
  fi

  # Responsive sizes
  for W in "${SIZES[@]}"; do
    if (( HAS_AVIF )); then
      out_avif_sz="${base_no_suffix}-${W}.avif"
      if [[ ! -f "$out_avif_sz" ]]; then
        ffmpeg -y -i "$inimg" \
          -vf "$(scale_filter_for_width "$W")" -frames:v 1 \
          -c:v libaom-av1 -still-picture 1 -cpu-used 6 -crf 30 -b:v 0 \
          "$out_avif_sz"
      else echo "    (skip) $out_avif_sz exists"; fi
    fi
    if (( HAS_WEBP )); then
      out_webp_sz="${base_no_suffix}-${W}.webp"
      if [[ ! -f "$out_webp_sz" ]]; then
        ffmpeg -y -i "$inimg" \
          -vf "$(scale_filter_for_width "$W")" -frames:v 1 \
          -c:v libwebp -lossless 0 -q:v 82 \
          "$out_webp_sz"
      else echo "    (skip) $out_webp_sz exists"; fi
    fi
  done

  echo "    -> generated image${idx}.* set"
  idx=$((idx+1))
done

echo "Done. Last index used: $((idx-1)). Next would be: $idx"

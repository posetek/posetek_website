#!/usr/bin/env bash
set -euo pipefail

: "${MOBILE_DIR:?MOBILE_DIR is required}"
: "${EXPECTED_SHA:?EXPECTED_SHA is required}"
: "${ARTIFACT_ROOT:?ARTIFACT_ROOT is required}"

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid mobile SHA' >&2; exit 1; }
actual_sha="$(git -C "$MOBILE_DIR" rev-parse HEAD)"
[[ "$actual_sha" == "$EXPECTED_SHA" ]] || { echo 'Mobile checkout is at a different revision' >&2; exit 1; }

source="$MOBILE_DIR/tools/contracts/device-performance-v1"
for component in "$MOBILE_DIR" "$MOBILE_DIR/tools" "$MOBILE_DIR/tools/contracts" "$source" "$source/fixtures"; do
  [[ -d "$component" && ! -L "$component" ]] || { echo "Missing directory or symlink: $component" >&2; exit 1; }
done
[[ -f "$source/schema.json" && ! -L "$source/schema.json" ]] || { echo 'Missing regular schema.json' >&2; exit 1; }
[[ -z "$(find "$source" -type l -print -quit)" ]] || { echo 'Mobile contract contains a symlink' >&2; exit 1; }

while IFS= read -r -d '' directory; do
  [[ "$directory" == "$source" || "$directory" == "$source/fixtures" ]] || {
    echo "Unexpected contract directory: $directory" >&2; exit 1;
  }
done < <(find "$source" -type d -print0)
while IFS= read -r -d '' file; do
  if [[ "$file" == "$source/schema.json" || "$file" == "$source/README.md" ]]; then
    continue
  fi
  if [[ "$(dirname "$file")" == "$source/fixtures" && "$file" == *.json ]]; then
    continue
  fi
  echo "Unexpected contract file: $file" >&2
  exit 1
done < <(find "$source" -type f -print0)

shopt -s nullglob
fixtures=("$source"/fixtures/*.json)
((${#fixtures[@]} > 0)) || { echo 'Mobile contract has no JSON fixtures' >&2; exit 1; }
mkdir -p "$ARTIFACT_ROOT/tools/contracts/device-performance-v1/fixtures"
cp "$source/schema.json" "$ARTIFACT_ROOT/tools/contracts/device-performance-v1/schema.json"
cp "${fixtures[@]}" "$ARTIFACT_ROOT/tools/contracts/device-performance-v1/fixtures/"
printf '%s\n' "$actual_sha" > "$ARTIFACT_ROOT/source-sha.txt"

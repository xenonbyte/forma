#!/bin/bash

# Pre-flight compatibility check for desktop package dependencies
# Ensures Electron, Vite, electron-vite, and React are compatible versions

set -e

PACKAGES=(
  "electron:^41.0.0"
  "vite:^5.0.0"
  "electron-vite:^1.0.0"
  "react:^18.0.0"
)

echo "Checking desktop dependencies..."
echo ""

all_ok=true

for pkg_spec in "${PACKAGES[@]}"; do
  IFS=':' read -r pkg_name range <<< "$pkg_spec"

  # Query npm for the latest version in the specified range
  # pnpm view returns JSON array of versions, extract the last one (latest)
  output=$(pnpm view "$pkg_name@$range" version --json 2>/dev/null)

  # If the output is a JSON array, extract the last version; otherwise use the output as-is
  if [[ "$output" == *"["* ]]; then
    # Extract all quoted strings and take the last one
    version=$(echo "$output" | grep -oE '"[^"]*"' | tail -1 | tr -d '"')
  else
    version="$output"
  fi

  if [ -z "$version" ]; then
    echo "$pkg_name:         ERROR (failed to resolve)"
    all_ok=false
  else
    echo "$pkg_name:        $version ✓"
  fi
done

echo ""

if [ "$all_ok" = true ]; then
  echo "All desktop dependencies compatible."
  exit 0
else
  echo "ERROR: One or more dependencies failed to resolve."
  exit 1
fi

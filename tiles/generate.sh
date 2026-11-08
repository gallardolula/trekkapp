#!/bin/bash
# Generates the vector tile archive for a named region.
#
# Geofabrik publishes no sub-extract for Córdoba, so the Argentina extract is
# downloaded once and clipped to the region's bounds. The extract is cached in
# data/ and reused on later runs.
#
# Java is installed keg-only by Homebrew and is therefore addressed by its full
# path, which avoids asking for a password to symlink it system wide.
set -euo pipefail

JAVA=${JAVA:-/opt/homebrew/opt/openjdk/bin/java}
AQUI=$(cd "$(dirname "$0")" && pwd)
REGION=${1:-sierras-de-cordoba}

leer() { node -e "
  const r = require('$AQUI/regions.json').regions.find(x => x.id === '$REGION');
  if (!r) { console.error('región desconocida: $REGION'); process.exit(1); }
  process.stdout.write(String(r.$1));
"; }

W=$(leer 'bounds.west'); S=$(leer 'bounds.south')
E=$(leer 'bounds.east'); N=$(leer 'bounds.north')
MINZ=$(leer 'minZoom');  MAXZ=$(leer 'maxZoom')

echo "región   $REGION"
echo "límites  $W,$S,$E,$N"
echo "zoom     $MINZ a $MAXZ"

"$JAVA" -Xmx4g -jar "$AQUI/planetiler.jar" \
  --download --area=argentina --download-dir="$AQUI/data" \
  --water-polygons-path="$AQUI/data/water-polygons-split-3857.zip" \
  --http-timeout=120s \
  --bounds="$W,$S,$E,$N" \
  --minzoom="$MINZ" --maxzoom="$MAXZ" \
  --output="$AQUI/out/$REGION.mbtiles" \
  --force

ls -lh "$AQUI/out/$REGION.mbtiles"

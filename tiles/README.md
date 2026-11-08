# Tile generation

Produces the vector tile archive the application downloads for offline use.

```bash
./generate.sh sierras-de-cordoba
```

Regions are declared in `regions.json`. The archive lands in `out/` and the
server reads it from there through `TILES_DIR`.

## What it does

Geofabrik publishes no sub-extract for Córdoba, so the Argentina extract is
downloaded once into `data/` and clipped to the region's bounds. The run takes
a few minutes and the extract is reused afterwards.

## Two things worth knowing

Java is installed keg-only by Homebrew, so `generate.sh` addresses it by full
path rather than expecting it on `PATH`. That avoids needing a password to
symlink it system wide. Override with `JAVA=/path/to/java`.

`data/water-polygons-split-3857.zip` is an **empty** shapefile built by
`make-empty-water.mjs`. Planetiler expects that archive to draw the ocean, the
host that publishes it was unreachable when the tiles were generated, and the
Sierras de Córdoba are a thousand kilometres from the sea. An archive with no
features is therefore the correct input rather than a stand-in. Replace it with
the real one if a region ever reaches a coast.

## Output

Nothing in `data/` or `out/` is versioned. Both are reproducible from this
script, and the archive is far too large for a repository.

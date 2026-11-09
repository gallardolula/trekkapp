# Integrations, Libraries and Providers

Everything the project depends on that it does not own: runtime libraries,
native capabilities, external APIs and service providers.

Related: [architecture.md](./architecture.md) · [data-model.md](./data-model.md)

---

## 1. Runtime libraries — mobile

| Library | Role | Why this one | ADR |
| --- | --- | --- | --- |
| `expo` | Managed native tooling, SDK modules, dev clients | A solo developer cannot maintain bare native projects for two platforms | — |
| `react-native` | UI runtime | Single codebase for Android and iOS | — |
| `typescript` (`strict`) | Language | Domain invariants expressed in types | — |
| `expo-router` | Navigation | File-based routing, deep links without manual wiring | — |
| `expo-sqlite` | Local database | Embedded, transactional, no server | [0001](./adr/0001-offline-first-local-store.md) |
| `@maplibre/maplibre-react-native` | Map rendering, offline regions | Open source, vector tiles, first-class offline pack API | [0008](./adr/0008-maplibre-for-map-rendering.md) |
| `expo-location` | Position fixes while a walk is under way, and one coarse fix to decide whether the hiker is at the trail | Standard Expo surface over both platform location stacks | — |
| `expo-document-picker`, `expo-file-system` | GPX import, and the directory photographs are kept in | Platform file access | — |
| `expo-image-picker` | Photographs of a walk | The camera. Required at runtime inside a try, so a build without it loses the button and nothing else | [0014](./adr/0014-photographs-stay-on-the-device.md) |
| `expo-secure-store` | Token storage | Keychain / Keystore backed | [0015](./adr/0015-offline-identity-is-a-claim.md) |
| `react-native-svg` | Track drawings, elevation profiles, icons, illustrated states | Already present for the schematic track; it removed the need for an icon font, which would have been another native module | — |

All of the above are installed. Two libraries anticipated in earlier revisions
were never needed: `zustand`, because the only cross-screen mutable state
turned out to live in the database, and `@tanstack/react-query`, because
synchronisation is explicit and its state is a queue rather than a cache.
`expo-task-manager` and `expo-notifications` went with background
synchronisation, which is out of scope.

### Development dependencies

| Library | Role |
| --- | --- |
| `jest`, `ts-jest`, `@types/jest` | Domain, parser, migration and synchronisation tests, executed on Node without a native preset |
| `pngjs`, `geojson-vt`, `vt-pbf` | Generating contour tiles and reading terrain heights, server side only. Pure JavaScript, so no toolchain beyond Node, and omitted from a production install |

### Deliberately absent

| Not used | Reason |
| --- | --- |
| XML parser library | The GPX subset needed is small and regex-driven; a parser would add a native dependency for no gain |
| Geospatial library (turf and similar) | Only three primitives are needed; they are ~100 lines and fully tested, against a large surface we would not use |
| HTTP client library | `fetch` is built in |
| Date library | ISO-8601 strings sort chronologically; no formatting beyond display |

Keeping the dependency surface small is a deliberate position: every library on
the critical path is one more thing that can break in the field.

---

## 2. Runtime libraries — backend

Built, under `server/`. Authentication, the catalogue delta, contributed
trails, moderation, report upload, the forecast cache and the tile region
index are all in place.

Tile archives are read with the runtime's own `node:sqlite`, since MBTiles is
a SQLite database and this avoids a dependency for it.

| Library | Role | Why |
| --- | --- | --- |
| `fastify` | HTTP server | Schema-based validation built in, lower overhead than Express |
| `pg` | PostgreSQL driver | |
| `@node-rs/argon2` | Password hashing | Argon2id at the OWASP minimums. Chosen over the `argon2` package because it ships prebuilt binaries and needs no C toolchain on the development machine |
| `jose` | JWT signing and verification | |
| `zod` | Shared request/response schemas | Same definitions usable by the app's API client |
| `fastify-plugin` | Decorator scope | Guards must be visible to every route, not only the plugin that declares them |

PostgreSQL 18 both in development and on the deployment target, so the two
cannot diverge on behaviour. PostGIS is **not** installed. It was specified
for proximity queries and no current requirement asks for one, so the
extension is introduced when the first such query exists rather than before.

| Environment | Database | Application |
| --- | --- | --- |
| Development | PostgreSQL 18 through Postgres.app | Node, `tsx watch` |
| Deployment | Supabase, free plan | Render web service, free plan, built from the repository with no container image |

---

## 3. Native capabilities

| Capability | Module | Android permission | iOS key | Expo Go |
| --- | --- | --- | --- | --- |
| Local database | `expo-sqlite` | — | — | Yes |
| File import | `expo-document-picker` | — | — | Yes |
| Foreground location | `expo-location` | `ACCESS_FINE_LOCATION` | `NSLocationWhenInUseUsageDescription` | Yes |
| Background location | `expo-location` + `expo-task-manager` | `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION` | `NSLocationAlwaysAndWhenInUseUsageDescription`, background mode `location` | **No** |
| Map and offline regions | `@maplibre/maplibre-react-native` 11.5 | — | — | **No**, falls back to a schematic track |
| Local notifications | `expo-notifications` | `POST_NOTIFICATIONS` (API 33+) | — | Partial |
| Secure storage | `expo-secure-store` | — | — | Yes |

**Sprint boundary**: Expo Go covers the domain, the catalogue, GPX import,
synchronisation and the forecast. The map needs a development build, built
with EAS for Android (`eas build --profile development --platform android`).

The boundary is softened rather than enforced: `src/ui/TrackMap.tsx` resolves
MapLibre with a runtime `require` and falls back to the schematic track when
the module is absent, so everything other than the basemap stays testable in
Expo Go.

### Permission strategy

Background location is requested only when the hiker starts a hike, with an
in-app explanation shown first. Both stores reject background location requested
at launch without justification, and the justification here is genuine: the
deviation alert has to work with the phone in a pocket.

---

## 4. External APIs

### Open-Meteo — forecast

| Aspect | Value |
| --- | --- |
| Purpose | Daily forecast for a trail's coordinates |
| Authentication | None; no API key for non-commercial use |
| Called from | Backend only, never the device ([ADR-0007](./adr/0007-forecast-through-backend.md)) |
| Variables consumed | Precipitation sum, maximum wind speed, minimum and maximum temperature |
| Cache | Per trail and date, TTL 3 h, persisted server-side |
| Device copy | Stored in `forecasts` with `obtained_at`, always rendered with its age |
| Failure mode | Unavailable or rate-limited |
| Degradation | Serve the last cached forecast, labelled stale. Download is never blocked for lack of a forecast; the absence is stated explicitly |
| Attribution | Required by their terms; rendered in the about screen |

Thresholds that turn a forecast into a warning live in the domain layer, not in
the integration. Changing the provider does not change the rules.

---

### Overpass — the catalogue

| Aspect | Value |
| --- | --- |
| Purpose | The named paths and hiking routes of a region, with their geometry |
| Authentication | None |
| Called from | A build-time script, never the application or the running server |
| Timing | Once per catalogue generation, into `src/startup/catalogue.json` |
| Failure mode | Gateway timeouts whenever a server is busy, which is often |
| Degradation | Several servers are tried in turn and then again after a wait. A mirror holding only one country answers happily with nothing, so an empty answer moves to the next server rather than being believed |
| Attribution | ODbL, required, shown on the catalogue screen ([ADR-0013](./adr/0013-catalogue-generated-from-openstreetmap.md)) |

### AWS Terrain Tiles — elevation

| Aspect | Value |
| --- | --- |
| Purpose | Heights for the contour lines and for the generated catalogue |
| Authentication | None; public bucket of the AWS Open Data registry |
| Called from | Build-time scripts only |
| Encoding | Height in metres spread across the colour channels of a PNG |
| Cache | Kept on disk between runs under `tiles/cache`, so regenerating does not re-download ground that has not moved |
| Attribution | Derived from SRTM and NASADEM ([ADR-0012](./adr/0012-contours-from-a-separate-elevation-source.md)) |

---

## 5. Data and infrastructure providers

| Provider | Used for | Timing | Notes |
| --- | --- | --- | --- |
| OpenStreetMap (via Geofabrik extracts) | Source data for map tiles | Build time only | No runtime dependency ([ADR-0006](./adr/0006-self-generated-map-tiles.md)) |
| Planetiler | Vector tile generation from the extract | Build time | Runs locally; no service account |
| Object storage (provider TBD) | Hosting tile archives per region | Download time, online | Served behind the API |
| Expo EAS | Development and store builds | Build time | Not on the runtime path |

**Not used**: the public OpenStreetMap tile servers. Their usage policy forbids
bulk downloading, which is precisely what an offline region requires.

---

## 6. Licensing obligations

| Asset | Licence | Obligation |
| --- | --- | --- |
| OpenStreetMap data and derived tiles | ODbL 1.0 | Attribution on the map surface and in the about screen; share-alike on derived databases |
| MapLibre Native | BSD-3-Clause | Licence notice |
| Expo / React Native | MIT | Licence notice |
| Open-Meteo data | CC BY 4.0 | Attribution |

Attribution is a licence condition, not a courtesy. A third-party notices screen
ships with the application.

---

## 7. Dependency policy

| Rule | Reason |
| --- | --- |
| Expo SDK modules are pinned by `expo install`, not by hand | Keeps native module versions aligned with the SDK |
| Exact versions in `package-lock.json`, committed | Reproducible builds |
| A new runtime dependency needs a line in this document stating what it replaces | Prevents silent growth of the dependency surface |
| No dependency on the critical hike path may require network at runtime | The hike path must work with the radio off |
| Upgrades happen between sprints, never during one | An SDK upgrade mid-sprint conflates two sources of failure |

---

## 8. Failure matrix

What breaks, and what the hiker experiences.

| Failure | During planning (online) | During the hike (offline) |
| --- | --- | --- |
| Backend unreachable | Catalogue shows cached content; sync deferred | No effect — no backend on the hike path |
| Open-Meteo unavailable | Last forecast shown with its age; download allowed with the gap stated | No effect — forecast already stored |
| Tile archive unreachable | Region download fails with a retry option | No effect — region already on device |
| GNSS degraded or lost | — | Last known position held; deviation evaluation suspended and the suspension is shown, never silently frozen |
| Local database corrupted | Re-sync from the server | Trail unavailable; the app states it rather than failing opaquely |

The single invariant behind this table: **no external provider sits on the
critical path once a hike is in progress.**

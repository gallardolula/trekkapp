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
| `zustand` | Active-hike session state | The only cross-screen mutable state; Redux is disproportionate | — |
| `@tanstack/react-query` | Server state: catalogue, forecast | Caching, retry and staleness semantics that would otherwise be hand-rolled | — |
| `expo-sqlite` | Local database | Embedded, transactional, no server | [0001](./adr/0001-offline-first-local-store.md) |
| `@maplibre/maplibre-react-native` | Map rendering, offline regions | Open source, vector tiles, first-class offline pack API | [0008](./adr/0008-maplibre-for-map-rendering.md) |
| `expo-location` | Position fixes, foreground and background | Standard Expo surface over both platform location stacks | — |
| `expo-task-manager` | Background task registration | Required for location updates with the screen off | — |
| `expo-notifications` | Local alert delivery | Deviation alerts must reach the hiker without network | — |
| `expo-document-picker`, `expo-file-system` | GPX import | Platform file access | — |
| `expo-secure-store` | Token storage | Keychain / Keystore backed | — |

**Installed today**: `expo`, `react-native`, `expo-sqlite`, `expo-document-picker`,
`expo-file-system`, `expo-status-bar`. The rest arrive with their sprint.

### Development dependencies

| Library | Role |
| --- | --- |
| `jest`, `ts-jest`, `@types/jest` | Domain and parser tests, executed on Node without a native preset |

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
trails, moderation, report upload and the forecast cache are in place. The
tile region index is not.

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
| Map and offline regions | `@maplibre/maplibre-react-native` | — | — | **No** |
| Local notifications | `expo-notifications` | `POST_NOTIFICATIONS` (API 33+) | — | Partial |
| Secure storage | `expo-secure-store` | — | — | Yes |

**Sprint boundary**: Expo Go covers the domain, the catalogue and GPX import.
From the map and the hike loop onwards a development build is required. Plan
accordingly rather than discovering it mid-sprint.

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
| Device copy | Stored in `pronosticos` with `obtenido_en`, always rendered with its age |
| Failure mode | Unavailable or rate-limited |
| Degradation | Serve the last cached forecast, labelled stale. Download is never blocked for lack of a forecast; the absence is stated explicitly |
| Attribution | Required by their terms; rendered in the about screen |

Thresholds that turn a forecast into a warning live in the domain layer, not in
the integration. Changing the provider does not change the rules.

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

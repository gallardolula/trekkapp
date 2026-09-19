# 8. MapLibre Native for map rendering

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

The application must render a basemap, a trail polyline and live position, and
must do so from tiles already on the device with no network. Offline region
management — downloading, storing, evicting — is a first-class requirement, not
an add-on.

## Decision

MapLibre Native through `@maplibre/maplibre-react-native`, consuming the vector
tiles from [ADR-0006](./0006-self-generated-map-tiles.md), with the map style
bundled in the app.

## Consequences

**Positive**

- Offline region packs are part of the SDK rather than something to build.
- Vector tiles render at any zoom from one archive and allow style changes
  without regenerating data.
- Open source, no licence cost, no usage key.

**Negative**

- A native module, so it does not run in Expo Go. Everything from the map
  onwards requires a development build — this sets a sprint boundary.
- Smaller community than the Google Maps SDK; fewer worked examples.

**Neutral**

- Style authoring becomes a project artefact that must be maintained.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Google Maps SDK | Offline support is limited to its own cached areas and not usable for arbitrary regions; API key and usage cost. |
| Apple Maps / platform maps | Platform-specific, no offline vector control. |
| `react-native-maps` | Thin wrapper over platform maps; the offline requirement is the whole point and it is not covered. |
| WebView with a JS map library | Performance and battery cost unacceptable for a continuous session. |

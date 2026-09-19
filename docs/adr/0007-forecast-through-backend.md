# 7. Forecast retrieved through the backend

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

Weather warnings require a forecast for a trail's coordinates. Open-Meteo serves
this without an API key, so the device could call it directly. But many devices
requesting the same few trails duplicates load, each device caches
independently, and the thresholds that turn a forecast into a warning would
either be duplicated or shipped only in the app.

## Decision

Only the backend calls the forecast provider. It caches per trail and date with
a three-hour TTL and exposes the result through its own endpoint. The device
stores what it receives in `pronosticos` together with `obtenido_en` and renders
it with its age.

## Consequences

**Positive**

- One cache shared by every user; upstream load is proportional to trails, not
  to devices.
- Changing or adding a provider does not require an app release.
- Rate limiting and failure handling live in one place.

**Negative**

- Forecast is unavailable when the backend is unreachable, even if the provider
  is up. Acceptable: both require connectivity, which the hike path does not have
  anyway.
- One more endpoint to operate.

**Neutral**

- Threshold evaluation stays in the domain layer on the device, so a cached
  forecast can still be evaluated offline.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Direct calls from the device | Duplicated load, per-device caches, provider coupling shipped in the app. |
| Precompute warnings server-side | Moves a safety rule off the device, where it must remain evaluable offline. |

-- Initial server schema.
--
-- It mirrors the device schema with the three differences recorded in
-- docs/data-model.md: ownership on every contribution, a monotonic
-- `updated_at` that drives the delta cursor, and tombstones so a deletion
-- reaches a device that was offline when it happened.
--
-- Geometry is kept as ordered rows rather than a PostGIS LINESTRING. No
-- current requirement asks for a proximity query, and adding the extension
-- before one exists would buy nothing. The column is introduced when the
-- first such query appears.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Every table that the device synchronises carries `updated_at`, and the
-- device asks for rows strictly greater than the cursor it stored. The
-- value must therefore never be set by hand.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ------------------------------------------------------------------ users --

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  level          TEXT NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  role           TEXT NOT NULL DEFAULT 'hiker' CHECK (role IN ('hiker', 'moderator')),
  -- Five consecutive failures lock the account for fifteen minutes, as the
  -- security policy of the project states.
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness without pulling in the citext extension.
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- --------------------------------------------------------- refresh tokens --

-- The refresh token rotates on every use. Only its hash is stored, so a dump
-- of this table does not hand over usable sessions.
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  -- A token that was already exchanged keeps its row, so presenting it again
  -- is detectable as reuse rather than silently accepted.
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id);


-- ----------------------------------------------------------------- trails --

CREATE TABLE trails (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT,
  -- Derived attributes are recomputed here on every write and never taken
  -- from the client, for the same reason the device does not take them from
  -- a contributor. See docs/adr/0003.
  distance_m       DOUBLE PRECISION NOT NULL,
  elevation_gain_m DOUBLE PRECISION NOT NULL,
  effort_index     DOUBLE PRECISION NOT NULL,
  difficulty       TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  status           TEXT NOT NULL DEFAULT 'pending_review'
                        CHECK (status IN ('published', 'pending_review', 'rejected')),
  -- Null for the trails preloaded by the project itself.
  owner_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  review_note      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The catalogue delta reads by cursor, so the index is on the cursor column.
CREATE INDEX trails_updated_at ON trails (updated_at);
CREATE INDEX trails_status ON trails (status);

CREATE TRIGGER trails_touch BEFORE UPDATE ON trails
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


CREATE TABLE track_points (
  trail_id  UUID NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  lat       DOUBLE PRECISION NOT NULL,
  lon       DOUBLE PRECISION NOT NULL,
  ele       DOUBLE PRECISION,
  time      TIMESTAMPTZ,
  PRIMARY KEY (trail_id, position)
);


-- ---------------------------------------------------------------- reports --

CREATE TABLE reports (
  -- Generated on the device. This is what makes the upload idempotent: a
  -- retry carries the same identifier and cannot create a second row.
  id          UUID PRIMARY KEY,
  trail_id    UUID NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  comment     TEXT,
  lat         DOUBLE PRECISION,
  lon         DOUBLE PRECISION,
  -- When the hiker wrote it, taken from the device clock, and when the
  -- server received it. They differ by however long the walk lasted.
  created_at  TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reports_trail ON reports (trail_id);
CREATE INDEX reports_updated_at ON reports (updated_at);

CREATE TRIGGER reports_touch BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ------------------------------------------------------------- tombstones --

-- A deleted row cannot carry its own deletion to a device that was offline,
-- so the deletion is recorded as a row of its own.
CREATE TABLE tombstones (
  entity     TEXT NOT NULL,
  entity_id  UUID NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, entity_id)
);

CREATE INDEX tombstones_deleted_at ON tombstones (deleted_at);


-- -------------------------------------------------------------- forecasts --

-- Shared cache. The upstream provider is called once per trail and date and
-- not once per device, which is the whole reason the forecast is fetched
-- here and not from the phone. See docs/adr/0007.
CREATE TABLE forecasts (
  trail_id         UUID NOT NULL REFERENCES trails(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  precipitation_mm DOUBLE PRECISION NOT NULL,
  wind_kmh         DOUBLE PRECISION NOT NULL,
  min_temp_c       DOUBLE PRECISION NOT NULL,
  max_temp_c       DOUBLE PRECISION NOT NULL,
  obtained_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trail_id, date)
);

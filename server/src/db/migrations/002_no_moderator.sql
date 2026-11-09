-- Removing the moderator.
--
-- The role existed for a review queue, and no account could ever hold it:
-- registration always wrote 'hiker' and nothing promoted anybody, so a
-- contributed trail entered 'pending_review' and stayed there. Beyond that
-- it promised a verification it could not perform, because whether a route
-- crosses private land, is closed for the season or holds a lethal ford is
-- not in its geometry and a reviewer looking at a track could not tell
-- either. The system validates contributions now. See src/trails/validation.ts.

ALTER TABLE users DROP COLUMN role;

-- The waiting state goes with the queue. Anything left in it was never
-- visible to anybody and has no review coming, so it becomes what it
-- actually is: a trail that is not in the catalogue. Whoever contributed it
-- can still reach it.
ALTER TABLE trails DROP CONSTRAINT trails_status_check;

UPDATE trails SET status = 'withdrawn' WHERE status = 'pending_review';

ALTER TABLE trails
  ADD CONSTRAINT trails_status_check CHECK (status IN ('published', 'withdrawn'));

ALTER TABLE trails ALTER COLUMN status SET DEFAULT 'published';

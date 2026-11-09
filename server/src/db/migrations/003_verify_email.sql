-- An address has to be proven before the account exists for anybody.
--
-- Registration used to hand back a usable pair of tokens the moment the form
-- was submitted, which meant nobody ever had to hold the address they signed
-- up with. Anyone could take somebody else's, and the only thing the server
-- knew about an address was that it was well formed.
--
-- So a registration now creates the row and stops. A six digit code goes to
-- the address, and the tokens are issued when the code comes back.

ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;

-- Everything that already exists was registered under the old rule and its
-- owner is already using it. Marked as verified rather than locked out.
UPDATE users SET email_verified_at = created_at;

-- The code that proves an address.
--
-- Its own table and not a column on the account, for the same reason the
-- refresh tokens have one: a code is issued, spent and replaced on its own
-- schedule, and the attempts against it are counted separately from the
-- failed sign ins of the account it belongs to.
--
-- Only the hash is stored. A dump of this table hands over nothing usable,
-- which matters more here than for a password because the code is short
-- enough to be read out loud.
CREATE TABLE email_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  -- The address the code was sent to, kept so a code is never valid for an
  -- address other than the one that received it.
  sent_to     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  -- Counted on the code and not on the account, so guessing at a code cannot
  -- lock somebody out of signing in.
  attempts    INTEGER NOT NULL DEFAULT 0,
  -- A spent code keeps its row, so presenting it again is refused as reuse
  -- instead of being accepted a second time.
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX email_codes_user ON email_codes (user_id);

-- At most one code is alive per account. Issuing a new one retires the
-- previous, which is what makes a resend unambiguous.
CREATE UNIQUE INDEX email_codes_one_live
  ON email_codes (user_id)
  WHERE consumed_at IS NULL;

-- A code is issued for a purpose, and there is more than one purpose now.
--
-- Confirming an address and recovering a password both send six digits and
-- both need the same life: an expiry, a cap on guesses, one use. What differs
-- is what spending the code does. So the table stays and learns which of the
-- two each row is for, rather than a second table that would have to repeat
-- the expiry, the attempts and the hashing.
--
-- Recovery was promised in the security chapter of the delivery and had no
-- implementation behind it. The notice that an account locked after five
-- failed attempts was promised there too, and is sent by the server rather
-- than recorded here.

ALTER TABLE email_codes
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'verify_email'
    CHECK (purpose IN ('verify_email', 'reset_password'));

-- At most one live code per account *and purpose*. Somebody confirming an
-- address and recovering a password at the same time is a strange thing to
-- do, but the previous index made it impossible rather than merely strange,
-- and it would have retired one code to issue the other.
DROP INDEX email_codes_one_live;

CREATE UNIQUE INDEX email_codes_one_live
  ON email_codes (user_id, purpose)
  WHERE consumed_at IS NULL;

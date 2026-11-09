# 16. An address is proven before the account exists

- **Status**: Accepted
- **Date**: 2026-11-09

## Context

Registration used to hand back a usable pair of tokens the moment the form was
submitted. Everything the server knew about the address somebody signed up
with was that it was well formed and that no other account held it. Nobody
ever had to be able to read what was sent to it.

That leaves three things broken, in increasing order of seriousness.

An account cannot be recovered. The address is the only way back in from
another device, which is the reason [0015](./0015-offline-identity-is-a-claim.md)
gives for having a server-side account at all, and an address nobody proved is
no way back in.

A typo is indistinguishable from a working address. Somebody who registers as
`luciana@gmial.com` has a working account and no route to it, and finds out
only the day their phone is replaced.

And anybody could register as anybody. The address is not merely unverified,
it is claimable: registering with a stranger's address produced a real
account, and because the unique index then treated that address as taken, the
person who actually holds it could never register with it at all.

Two shapes were considered. A code at every sign in, which is ordinary
two-factor authentication, and a code once at registration.

A code at every sign in defends against a stolen or reused password, which the
existing five-failure lock does not. But it puts a third party in the critical
path of the one flow that gates everything else, and signing in is already the
only exchange this application cannot do without connectivity. A mail that is
slow or filtered becomes an application that cannot be opened.

## Decision

The address is proven once, at registration, and the account does not exist
for anybody until it is.

`POST /api/auth/register` writes the account row and answers `202` with
nothing usable. A six digit code goes to the address.
`POST /api/auth/register/verify` is the only place a first session is issued.
`POST /api/auth/register/resend` sends another, at most one a minute.

Signing in with the right password against an unproven address is answered
`403 email_not_verified` together with that address, and a fresh code is sent.
This is not an error state. It is where somebody who closed the application
mid-registration belongs, and the device takes them to the screen that asks
for the code.

The strength is not in the code. Six digits is a million possibilities, which
is nothing; what makes it sound is everything around it. A code lives fifteen
minutes, survives five wrong guesses, works once, is valid only for the
address it was sent to, and another can be asked for only every sixty seconds.
Only its Argon2 hash is stored, with the same parameters as a password, which
is more than it needs and costs the server a fraction of a second once per
registration.

Attempts are counted against the code and never against the account. Counted
against the account, guessing at somebody's verification code would lock them
out of signing in, which hands a stranger a way to shut an account down.

A dead code is not deleted. It stays as the reason the next attempt is
refused, because `ask for another code` is a different thing to tell somebody
than `there is no code`. Issuing the replacement is what retires it.

A registration arriving for an address that holds an **unproven** account
replaces it, password and all. This is the half of the decision that closes
the claiming hole: without it, registering with somebody else's address and
walking away would keep them out of their own for good. An address holding a
**proven** account stays taken, as before.

Delivery failure is not registration failure. The row stays and the person
asks for another code, which is better than rolling back an account they were
already told about.

Mail is configured through the environment, because the credential belongs to
whoever runs the server. Unconfigured, the server starts anyway and writes
every code to its own log, which is what lets the suite run and lets somebody
work locally with no mail account. It says so at startup and again on every
send, because a server that silently stopped delivering codes looks exactly
like one that works.

## Consequences

Registering now takes two exchanges and a trip to another application. That is
a real cost paid by every hiker once, and it is the point: the address is worth
something only because it was inconvenient to prove.

The prototype depends on a mail provider it does not control. A code that is
slow, filtered as spam or refused by the provider is a registration that
cannot be finished, and no amount of care in this codebase prevents it. The
`resend` endpoint and the `403` on sign in exist so that nobody is stranded by
one lost message, but somebody whose provider refuses the mail entirely cannot
register at all. With Gmail this means an application password, which in turn
requires two step verification on the sending account.

Every test that needs a token now needs two exchanges. Three test files were
writing the registration out by hand and now share one helper that registers,
reads the code from the mailer's outbox and confirms. The outbox is not a stub:
it is what the real module does when no transport is configured, so the suite
exercises the actual route, mail and all.

Accounts that existed before this record were marked proven by the migration.
They were registered under the old rule and their owners are using them, and
locking them out to satisfy a rule introduced afterwards would be the wrong
reading of a prototype's history.

Two step verification at sign in is **not** adopted and is not ruled out. It
defends against a stolen password, which this record does not address, and the
machinery it would need now exists.

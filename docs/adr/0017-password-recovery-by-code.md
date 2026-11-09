# 17. Password recovery by code, and the lock is reported to its owner

- **Status**: Accepted
- **Date**: 2026-11-09

## Context

The security chapter of the delivery stated two things the code did not do.
That a lock after five failed attempts notifies the account holder by mail,
and that password recovery happens through a single-use link expiring in
thirty minutes. Neither existed. There was no way to send a mail at all until
[0016](./0016-an-address-is-proven-before-the-account-exists.md), which is
presumably why.

A document that promises a security control the system lacks is worse than one
that promises nothing. The gap had to close in one direction or the other, and
with a mail transport now in place both controls are mostly reuse rather than
new machinery.

Recovery also became reachable only now. Recovering a password means sending a
secret to an address and trusting whoever reads it, which is exactly the trust
that an unproven address does not earn. Before addresses were proven, recovery
would have been a way to take an account rather than to get one back.

## Decision

**The lock is reported to its owner.** When five consecutive failures lock an
account, a mail goes to the address saying so and for how long. Sent on the
lock and not on each failure, so a forgotten password produces one message and
not five. It asks nothing of the reader: somebody who mistyped their own
password five times needs no instructions, and somebody who did not is the
reason the message exists.

**Recovery is a six digit code and not a link.** This departs from the wording
of the delivery, which said a link, and the reason is concrete: a link has to
reopen the application through its own URL scheme, and a development client
does not register that scheme. A link could therefore not be exercised at all
on the device this prototype is tested on, which makes it a control that
cannot be demonstrated. A code is also less to do on a phone, where the
message and the field sit on the same screen. The delivery document is
corrected to say code.

The code reuses everything 0016 built, which is the point. The same table, the
same fifteen minute life, the same five attempts, the same single use, the same
sixty second cooldown, the same Argon2 hash, the same rule that a code is valid
only for the address that received it. The table learned a `purpose`, and a
code issued to confirm an address is refused for recovery and the other way
round. Without that column the two would have been interchangeable, which would
have meant that anybody who could read a confirmation code could also replace
the password.

**Recovery closes every other session.** The new password is set, then every
refresh token of the account is revoked, and only then is a session issued.
Somebody recovering a password may be doing it precisely because another
person has the old one, and leaving that person's refresh token alive would
make the exercise pointless.

**Recovery issues a session rather than returning to the sign in screen.** The
person has just proved they hold the address and just chosen the password,
which is strictly more than signing in asks of them.

**Only a proven address can be recovered.** An account whose address was never
confirmed has a registration to finish instead, and signing in already sends
them there. Allowing recovery on it would be a second route to claim an
address nobody has held, which is the hole 0016 exists to close.

**Both endpoints refuse to say whether an address is registered.** The request
for a code is accepted whatever the address turns out to be and sends nothing
when there is nothing to send; a reset against an unknown or unproven address
is answered as a wrong code. A recovery endpoint that answers differently for
a registered address is a list of every account in the system.

## Consequences

Thirty minutes became fifteen, because the code shares its life with the
confirmation code rather than carrying a second expiry. Fifteen minutes is
shorter than the document said and ample for a code read on the same phone.

Recovery depends on mail, so an account whose address no longer works cannot
be recovered by any means this system offers. That is the cost of having no
second factor and no support desk, and it is the honest state of a prototype.

The lock notice is sent to an address that five failed attempts give no reason
to trust less, which is correct, but it does mean a stranger hammering an
account can cause a mail to be sent to its owner once every fifteen minutes.
The cooldown on codes does not cover this path. At prototype scale the cost is
a mail; at any real scale it would need its own rate limit.

The `purpose` column makes the one live code per account into one per account
and purpose. Somebody confirming an address and recovering a password at the
same moment is strange, and it is now merely strange rather than impossible.

The claim about a single-use link is removed from the delivery, and with it the
thirty minutes. A document that describes a control the system does not have
is the thing this record was written to stop.

---
name: Google-session-only private data
description: Security boundary for Goal Tracker data and the safe handling of historical backup identities.
---

Private Goal Tracker routes must require a valid Passport Google session. Browser
device UUIDs may support local caching or anonymous visitor counting, but they
must never authorize private API access. Signed-out users must see only the login
screen, including in development and embedded previews.

**Why:** A temporary login-removal migration accepted caller-supplied Bearer
identities and globally copied the richest state into empty identities. Combined
with a development UI bypass, this displayed the owner’s tasks before login and
made state readable or writable without a Google session.

**How to apply:** Never restore device-Bearer authorization, a development auth
bypass, or “richest global state” recovery. Any account migration must be explicit,
authenticated, source-specific, and non-destructive. Keep historical database
copies as backups, but do not expose or auto-copy them to unauthenticated callers.

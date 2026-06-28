---
name: Curl testing the dev server
description: How to hit the running app/api from the shell during development
---

The `REPLIT_DEV_DOMAIN` env var holds a bare hostname (e.g. `abc-00-xyz.kirk.replit.dev`) with **no** `https://` prefix.

**Rule:** always curl as `https://$REPLIT_DEV_DOMAIN/<path>`.

**Why:** `curl "$REPLIT_DEV_DOMAIN/api/..."` (no scheme) fails instantly with `HTTP 000` in a few milliseconds — it's not a server problem, curl just can't resolve a scheme-less URL.

**How to apply:** the proxy routes `/api` → api-server, and the web frontend is served at `/`, so e.g. `curl -X POST "https://$REPLIT_DEV_DOMAIN/api/psychology/analysis" ...`. No `setBaseUrl` is needed for the web client since it calls relative `/api/...`.

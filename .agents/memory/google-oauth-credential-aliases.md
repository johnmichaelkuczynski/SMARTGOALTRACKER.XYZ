---
name: Google OAuth credential aliases
description: Why production OAuth intentionally selects credentials from two differently named aliases.
---

Production Google OAuth must prefer the generic client ID together with the login-specific client secret.

**Why:** A non-destructive token-endpoint check showed that this cross-alias pair is accepted by Google (the intentionally invalid authorization code reached `invalid_grant`). The same-name generic pair returned `invalid_client`, while the login-specific client ID returned `deleted_client`.

**How to apply:** Preserve the validated precedence when editing authentication or environment handling. If login fails again, validate credential health without printing values; do not assume matching name prefixes form a valid pair.
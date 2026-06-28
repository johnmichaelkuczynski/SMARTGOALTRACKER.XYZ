---
name: Embedded preview iframe breaks cookie auth
description: Why the in-workspace preview shows 401 on every API call even when prod works fine
---

The Replit in-workspace preview renders the app inside a cross-site iframe
(`*.kirk.replit.dev/__replco/workspace_iframe.html`). Clerk's session cookie is
SameSite, so it is NOT sent on API calls made from that embedded frame — every
authenticated request returns 401, and the app looks "broken" / "data wiped" /
"upload doesn't work."

**Why:** cross-site iframe + SameSite cookie = no auth cookie attached. This is a
preview-sandbox limitation, not an app bug. Production (same-origin custom domain)
is unaffected.

**How to apply:** When the user reports the dev app is broken (401s, no data,
uploads failing) while viewing the embedded preview, do NOT chase it as a code
bug. Verify prod via deployment logs / SQL first. Tell the user to either open the
dev app in a full browser tab (cookie becomes first-party) or just use the live
app. The screenshot tool hits the same wall from the other side (localhost proxy
is unauthenticated), so it shows the signed-out landing page for auth-gated routes
— you cannot visually verify authed pages this way; trust typecheck + HMR logs.

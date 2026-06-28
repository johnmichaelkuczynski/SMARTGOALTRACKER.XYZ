---
name: Clerk managed-key overwrite via secure prompt
description: How a Replit-managed Clerk project breaks when managed keys get overwritten with external/invalid values, and how to recover.
---

When a project's code uses Replit-managed Clerk patterns (`publishableKeyFromHost`,
`VITE_CLERK_PROXY_URL`, provisioned via `setupClerkWhitelabelAuth()`), opening a
secure prompt / `requestEnvVar` for the Clerk keys lets the user paste their OWN
(external or garbage) Clerk values over the managed ones.

**Symptom:** white-screen app; browser console "Failed to load Clerk JS, failed to
load script: https://clerk.<dev-domain>/npm/@clerk/clerk-js@6/...";
`checkClerkManagementStatus()` returns `external` (not `managed`).

**Fix:** re-run `setupClerkWhitelabelAuth()` (idempotent) to restore
CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY / VITE_CLERK_PUBLISHABLE_KEY, confirm
`checkClerkManagementStatus()` returns `managed`, then restart BOTH the API and
frontend workflows so Vite re-bakes the publishable key.

**Why:** managed keys are auto-provisioned and swapped to live keys at publish time;
hand-pasted external keys point at a non-existent FAPI so clerk-js never loads.

**How to apply:** never request Clerk keys via a secret prompt on a managed-Clerk
project. If status is unexpectedly `external` on a project whose code is clearly
built for managed Clerk, re-provision rather than hand-editing secrets.

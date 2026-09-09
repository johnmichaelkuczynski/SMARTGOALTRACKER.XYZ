---
name: pnpm workspace audit fixes
description: Non-obvious behavior of pnpm audit remediation in this workspace.
---

Run the required per-manifest audit commands, but expect every workspace package invocation to target the shared workspace configuration. The command may reserialize the workspace YAML, add overlapping advisory-range overrides, and stop before changing the lockfile.

**Why:** Treating a successful `pnpm audit --fix` exit as a completed remediation left vulnerable versions pinned until a separate install regenerated the shared lockfile.

**How to apply:** After workspace audit fixes, review direct vulnerable dependencies, remove conflicting older exact overrides, run `pnpm install`, then verify both a zero-finding audit and absence of every reported exact package/version key in all manifests and lockfiles.
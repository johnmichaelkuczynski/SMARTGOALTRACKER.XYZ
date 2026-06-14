---
name: Clerk + Tailwind v4 CSS setup
description: How to wire @clerk/themes shadcn theme into a Tailwind v4 (@tailwindcss/vite) app without build errors.
---

When using Clerk's `shadcn` theme object (`@clerk/themes`) with `cssLayerName: "clerk"` in a Tailwind v4 project (`@import "tailwindcss"` via `@tailwindcss/vite`):

- In `index.css`, declare the layer order BEFORE importing tailwind, and import the shadcn CSS **plainly** — do NOT wrap it in `layer(...)`:
  ```css
  @layer theme, base, clerk, components, utilities;
  @import "tailwindcss";
  @import "@clerk/themes/shadcn.css";
  ```
  **Why:** wrapping it as `@import "@clerk/themes/shadcn.css" layer(clerk);` nests the `@source` directive that file contains, and Tailwind throws `[plugin:@tailwindcss/vite:generate:serve] '@source' cannot be nested.` (HTTP 500, blank app). The `cssLayerName: "clerk"` appearance option already routes Clerk's classes into the declared `clerk` layer — no `layer()` wrapper needed.
- In `vite.config.ts`, pass `tailwindcss({ optimize: false })`. **Why:** without it, nested `@layer` imports from `@clerk/themes/*.css` get reordered in prod builds — Clerk UI looks right in dev but broken in prod.

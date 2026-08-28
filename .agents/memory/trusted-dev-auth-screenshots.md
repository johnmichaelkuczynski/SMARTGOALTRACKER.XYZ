---
name: Trusted development auth and screenshots
description: Why static appPreview screenshots cannot open owner-only development pages in this project.
---

Keep the development owner bypass restricted to the exact trusted Replit development hostname. Do not broaden it to localhost or `127.0.0.1` just to make static screenshots work.

**Why:** The static app-preview screenshot service opens the artifact through a localhost URL, which correctly fails this project's strict development-host check. Allowing localhost would weaken the private-workspace boundary.

**How to apply:** Verify authenticated pages with the browser testing flow through the Replit development domain. Treat a localhost-only screenshot authentication failure as expected when that browser flow passes.
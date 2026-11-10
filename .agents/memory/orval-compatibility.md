---
name: Workspace Orval compatibility
description: Why code generation needs an explicit Zod target and iterable browser types in this catalog-based workspace.
---

Keep the generator's Zod output target aligned explicitly with the workspace's actual Zod major version rather than relying on auto-detection through a catalog dependency.

**Why:** Orval auto-detection treated the catalog-based Zod 3 dependency as Zod 4 and generated unsupported integer helpers. Regeneration also uses iterable Headers methods, which require DOM iterable declarations in the client library.

**How to apply:** When changing API contracts or upgrading codegen, validate the generated Zod code against the installed major version and run the workspace library type check before testing app packages. Do not hand-edit generated files to work around incompatible output.

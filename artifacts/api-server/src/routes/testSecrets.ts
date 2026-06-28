import { Router, type IRouter } from "express";

const router: IRouter = Router();

const SECRET_KEYS = [
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "DEFAULT_OBJECT_STORAGE_BUCKET_ID",
  "PRIVATE_OBJECT_DIR",
  "PUBLIC_OBJECT_SEARCH_PATHS",
  "SESSION_SECRET",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "ASSEMBLYAI_API_KEY",
  "ELEVENLABS_API_KEY",
] as const;

router.get("/test-secrets", (_req, res) => {
  const results = SECRET_KEYS.map((key) => {
    const value = process.env[key];
    return {
      key,
      status: value && value.length > 0 ? "loaded" : "missing",
    };
  });

  const summary = {
    total: results.length,
    loaded: results.filter((r) => r.status === "loaded").length,
    missing: results.filter((r) => r.status === "missing").length,
  };

  res.json({ summary, results });
});

export default router;

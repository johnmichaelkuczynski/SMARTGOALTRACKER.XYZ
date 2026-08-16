-- Enforce one row per (job_id, job_type, tier).
-- Prevents duplicate tier rows that arise from concurrent compressions.
-- Safe to apply only after confirming no existing duplicates.
ALTER TABLE "tractatus_tiers"
  ADD CONSTRAINT "uq_tractatus_tiers_job_tier" UNIQUE ("job_id", "job_type", "tier");

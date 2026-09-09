CREATE TABLE IF NOT EXISTS "billing_accounts" (
  "user_id" TEXT PRIMARY KEY,
  "stripe_customer_id" TEXT UNIQUE NOT NULL,
  "stripe_subscription_id" TEXT UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'inactive',
  "price_id" TEXT,
  "current_period_end" TIMESTAMPTZ,
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "pending_checkout_session_id" TEXT,
  "pending_checkout_url" TEXT,
  "pending_checkout_expires_at" TIMESTAMPTZ,
  "checkout_token" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
  "stripe_subscription_id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "stripe_customer_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "price_id" TEXT,
  "current_period_end" TIMESTAMPTZ,
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "stripe_created_at" TIMESTAMPTZ NOT NULL,
  "last_event_created" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "billing_subscriptions_user_status"
  ON "billing_subscriptions" ("user_id", "status");

CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "event_id" TEXT PRIMARY KEY,
  "event_type" TEXT NOT NULL,
  "processed_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
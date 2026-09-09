import { randomUUID } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import Stripe from "stripe";
import type { Pool, PoolClient } from "pg";
import { pool } from "@workspace/db";

const router: IRouter = Router();
const NON_TERMINAL_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

function stripeClient(): Stripe {
  const key =
    process.env.NODE_ENV === "production"
      ? process.env.STRIPE_LIVE_SECRET_KEY
      : process.env.STRIPE_TEST_SECRET_KEY;
  if (!key?.trim()) throw new Error("Stripe secret key is not configured");
  return new Stripe(key.trim());
}

function configuredPriceId(): string {
  const priceId =
    process.env.NODE_ENV === "production"
      ? process.env.STRIPE_LIVE_PRICE_ID
      : process.env.STRIPE_TEST_PRICE_ID || process.env.STRIPE_PRICE_ID;
  if (!priceId?.trim()) {
    throw new Error(
      process.env.NODE_ENV === "production"
        ? "STRIPE_LIVE_PRICE_ID is not configured"
        : "Stripe test Price ID is not configured",
    );
  }
  return priceId.trim();
}

function configuredWebhookSecret(): string {
  const secret =
    process.env.NODE_ENV === "production"
      ? process.env.STRIPE_LIVE_WEBHOOK_SECRET
      : process.env.STRIPE_TEST_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret?.trim()) {
    throw new Error(
      process.env.NODE_ENV === "production"
        ? "STRIPE_LIVE_WEBHOOK_SECRET is not configured"
        : "Stripe test webhook secret is not configured",
    );
  }
  return secret.trim();
}

function requestOrigin(req: Parameters<RequestHandler>[0]): string {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const allowedHosts = new Set(
    [
      ...(process.env.REPLIT_DOMAINS || "").split(","),
      process.env.REPLIT_DEV_DOMAIN || "",
      "smartgoaltracker.xyz",
      "www.smartgoaltracker.xyz",
      "smartgoaltrackerxyz.replit.app",
      "www.smartgoaltrackerxyz.replit.app",
      "localhost:8080",
    ]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!host || !allowedHosts.has(host)) throw new Error("Untrusted request host");
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  return `${forwardedProto || (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

function safeReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\/[A-Za-z0-9/_?=&.-]*$/.test(value) ||
    value.startsWith("//")
  ) {
    return "/billing";
  }
  return value;
}

async function ensureBillingTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_accounts (
      user_id TEXT PRIMARY KEY,
      stripe_customer_id TEXT UNIQUE NOT NULL,
      stripe_subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'inactive',
      price_id TEXT,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
      pending_checkout_session_id TEXT,
      pending_checkout_url TEXT,
      pending_checkout_expires_at TIMESTAMPTZ,
      checkout_token TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE billing_accounts
      ADD COLUMN IF NOT EXISTS pending_checkout_session_id TEXT,
      ADD COLUMN IF NOT EXISTS pending_checkout_url TEXT,
      ADD COLUMN IF NOT EXISTS pending_checkout_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS checkout_token TEXT;
    CREATE TABLE IF NOT EXISTS billing_subscriptions (
      stripe_subscription_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      stripe_customer_id TEXT NOT NULL,
      status TEXT NOT NULL,
      price_id TEXT,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
      stripe_created_at TIMESTAMPTZ NOT NULL,
      last_event_created BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS billing_subscriptions_user_status
      ON billing_subscriptions (user_id, status);
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function periodEnd(subscription: Stripe.Subscription): Date | null {
  const unix = subscription.items.data[0]?.current_period_end;
  return unix ? new Date(unix * 1000) : null;
}

type Queryable = Pool | PoolClient;

async function upsertSubscription(
  client: Queryable,
  userId: string,
  customerId: string,
  subscription: Stripe.Subscription,
  eventCreated: number,
): Promise<void> {
  await client.query(
    `
      INSERT INTO billing_subscriptions (
        stripe_subscription_id, user_id, stripe_customer_id, status, price_id,
        current_period_end, cancel_at_period_end, stripe_created_at,
        last_event_created, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      ON CONFLICT (stripe_subscription_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        status = EXCLUDED.status,
        price_id = EXCLUDED.price_id,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        last_event_created = EXCLUDED.last_event_created,
        updated_at = now()
      WHERE billing_subscriptions.last_event_created <= EXCLUDED.last_event_created
    `,
    [
      subscription.id,
      userId,
      customerId,
      subscription.status,
      subscription.items.data[0]?.price.id ?? null,
      periodEnd(subscription),
      subscription.cancel_at_period_end,
      new Date(subscription.created * 1000),
      eventCreated,
    ],
  );
}

function chooseCurrentSubscription(subscriptions: Stripe.Subscription[]) {
  const priority = ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"];
  return [...subscriptions].sort((a, b) => {
    const rankA = priority.indexOf(a.status);
    const rankB = priority.indexOf(b.status);
    if (rankA !== rankB) {
      return (rankA === -1 ? priority.length : rankA) -
        (rankB === -1 ? priority.length : rankB);
    }
    return b.created - a.created;
  })[0];
}

router.get("/billing/status", async (req, res): Promise<void> => {
  try {
    await ensureBillingTables();
    configuredPriceId();
    const result = await pool.query<{ stripe_customer_id: string }>(
      "SELECT stripe_customer_id FROM billing_accounts WHERE user_id = $1",
      [req.userId!],
    );
    const customerId = result.rows[0]?.stripe_customer_id;
    if (!customerId) {
      res.json({
        configured: true,
        status: "inactive",
        active: false,
        customerExists: false,
      });
      return;
    }

    const subscriptions = await stripeClient().subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    const observedAt = Math.floor(Date.now() / 1000);
    for (const subscription of subscriptions.data) {
      await upsertSubscription(pool, req.userId!, customerId, subscription, observedAt);
    }
    const current = chooseCurrentSubscription(subscriptions.data);
    res.json({
      configured: true,
      status: current?.status ?? "inactive",
      active: current?.status === "active" || current?.status === "trialing",
      customerExists: true,
      currentPeriodEnd: current ? periodEnd(current) : null,
      cancelAtPeriodEnd: current?.cancel_at_period_end ?? false,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load billing status");
    res.status(500).json({ error: "Could not load billing status" });
  }
});

router.post("/billing/checkout", async (req, res): Promise<void> => {
  try {
    await ensureBillingTables();
    const stripe = stripeClient();
    const userId = req.userId!;
    const priceId = configuredPriceId();
    const dbClient = await pool.connect();
    let customerId = "";
    let checkoutToken = "";
    let cachedUrl: string | null = null;

    try {
      await dbClient.query("BEGIN");
      await dbClient.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);
      const account = await dbClient.query<{
        stripe_customer_id: string;
        pending_checkout_url: string | null;
        pending_checkout_expires_at: Date | null;
        checkout_token: string | null;
      }>(
        `SELECT stripe_customer_id, pending_checkout_url,
                pending_checkout_expires_at, checkout_token
           FROM billing_accounts WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );

      customerId = account.rows[0]?.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create(
          {
            email: req.user?.email ?? undefined,
            name: req.user?.displayName ?? req.user?.username,
            metadata: { userId },
          },
          { idempotencyKey: `goal-tracker-customer-${userId}` },
        );
        customerId = customer.id;
        await dbClient.query(
          `INSERT INTO billing_accounts (user_id, stripe_customer_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             updated_at = now()`,
          [userId, customerId],
        );
      }

      const pending = account.rows[0];
      if (
        pending?.pending_checkout_url &&
        pending.pending_checkout_expires_at &&
        pending.pending_checkout_expires_at.getTime() > Date.now()
      ) {
        cachedUrl = pending.pending_checkout_url;
        await dbClient.query("COMMIT");
      } else {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 100,
        });
        const blocking = subscriptions.data.find((item) =>
          NON_TERMINAL_STATUSES.has(item.status),
        );
        if (blocking) {
          await upsertSubscription(
            dbClient,
            userId,
            customerId,
            blocking,
            Math.floor(Date.now() / 1000),
          );
          await dbClient.query("COMMIT");
          res.status(409).json({
            error: "An existing subscription must be managed before starting another",
          });
          return;
        }

        checkoutToken = pending?.checkout_token || randomUUID();
        if (!pending?.checkout_token || pending.pending_checkout_expires_at) {
          checkoutToken = randomUUID();
        }
        await dbClient.query(
          `UPDATE billing_accounts SET
             checkout_token = $2,
             pending_checkout_session_id = NULL,
             pending_checkout_url = NULL,
             pending_checkout_expires_at = NULL,
             updated_at = now()
           WHERE user_id = $1`,
          [userId, checkoutToken],
        );
        await dbClient.query("COMMIT");
      }
    } catch (error) {
      await dbClient.query("ROLLBACK");
      throw error;
    } finally {
      dbClient.release();
    }

    if (cachedUrl) {
      res.json({ url: cachedUrl, reused: true });
      return;
    }

    const returnPath = safeReturnPath(req.body?.returnPath);
    const returnUrl = `${requestOrigin(req)}${returnPath}`;
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        client_reference_id: userId,
        metadata: { userId },
        subscription_data: { metadata: { userId } },
        success_url: `${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl}?checkout=cancelled`,
      },
      { idempotencyKey: `goal-tracker-checkout-${userId}-${checkoutToken}` },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    await pool.query(
      `UPDATE billing_accounts SET
         pending_checkout_session_id = $2,
         pending_checkout_url = $3,
         pending_checkout_expires_at = $4,
         updated_at = now()
       WHERE user_id = $1 AND checkout_token = $5`,
      [userId, session.id, session.url, new Date(session.expires_at * 1000), checkoutToken],
    );
    res.json({ url: session.url });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create Stripe checkout");
    res.status(500).json({ error: "Could not start checkout" });
  }
});

router.post("/billing/portal", async (req, res): Promise<void> => {
  try {
    await ensureBillingTables();
    const result = await pool.query<{ stripe_customer_id: string }>(
      "SELECT stripe_customer_id FROM billing_accounts WHERE user_id = $1",
      [req.userId!],
    );
    const customerId = result.rows[0]?.stripe_customer_id;
    if (!customerId) {
      res.status(404).json({ error: "No billing account exists yet" });
      return;
    }
    const session = await stripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${requestOrigin(req)}${safeReturnPath(req.body?.returnPath)}`,
    });
    res.json({ url: session.url });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create Stripe billing portal");
    res.status(500).json({ error: "Could not open billing management" });
  }
});

export const stripeWebhookHandler: RequestHandler = async (req, res) => {
  const signature = req.headers["stripe-signature"];
  if (!signature || Array.isArray(signature)) {
    res.status(400).json({ error: "Missing Stripe webhook signature" });
    return;
  }

  try {
    const stripe = stripeClient();
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      configuredWebhookSecret(),
    );
    await ensureBillingTables();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO stripe_webhook_events (event_id, event_type)
         VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.id, event.type],
      );
      if (inserted.rowCount === 0) {
        await client.query("ROLLBACK");
        res.json({ received: true, duplicate: true });
        return;
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.userId;
        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (userId && customerId) {
          await client.query(
            `INSERT INTO billing_accounts (user_id, stripe_customer_id, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (user_id) DO UPDATE SET
               stripe_customer_id = EXCLUDED.stripe_customer_id,
               pending_checkout_session_id = NULL,
               pending_checkout_url = NULL,
               pending_checkout_expires_at = NULL,
               checkout_token = NULL,
               updated_at = now()`,
            [userId, customerId],
          );
          if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            await upsertSubscription(
              client,
              userId,
              customerId,
              subscription,
              event.created,
            );
          }
        }
      }

      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        const deliveredSubscription = event.data.object;
        let subscription = deliveredSubscription;
        try {
          subscription = await stripe.subscriptions.retrieve(deliveredSubscription.id);
        } catch (error) {
          if (event.type !== "customer.subscription.deleted") throw error;
        }
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        const mapping = await client.query<{ user_id: string }>(
          "SELECT user_id FROM billing_accounts WHERE stripe_customer_id = $1",
          [customerId],
        );
        const userId = subscription.metadata.userId || mapping.rows[0]?.user_id;
        if (userId) {
          await upsertSubscription(client, userId, customerId, subscription, event.created);
        }
      }

      await client.query("COMMIT");
      res.json({ received: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    req.log.error({ err: error }, "Stripe webhook processing failed");
    res.status(400).json({ error: "Invalid or unprocessable Stripe webhook" });
  }
};

export default router;
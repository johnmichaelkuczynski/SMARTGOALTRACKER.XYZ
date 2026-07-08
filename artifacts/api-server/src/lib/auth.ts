import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Express, RequestHandler } from "express";
import { storage } from "./authStorage";
import pg from "pg";

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      googleId?: string | null;
      email?: string | null;
      displayName?: string | null;
    }
  }
}

export async function setupAuth(app: Express): Promise<void> {
  const sanitizeSecret = (v?: string) =>
    (v || "").replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "").trim();

  const clientID = sanitizeSecret(
    process.env.GOOGLE_LOGIN_CLIENT_ID ||
      process.env.GOOGLE_OAUTH_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID,
  );
  const clientSecret = sanitizeSecret(
    process.env.GOOGLE_LOGIN_CLIENT_SECRET ||
      process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
      process.env.GOOGLE_CLIENT_SECRET,
  );

  const googleEnabled = !!(clientID && clientSecret);

  if (!googleEnabled) {
    console.warn(
      "Google OAuth credentials not found (GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET). Google login disabled.",
    );
  }

  app.set("trust proxy", 1);

  const PgSession = connectPgSimple(session);
  const pool = new pg.Pool({
    connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  pool.on("error", (err: Error) => {
    console.error("Session pool error:", err);
  });

  pool.on("connect", () => {
    console.log("Session pool connected to database");
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "user_sessions" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    );
    CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire" ON "user_sessions" ("expire");
  `);

  console.log("Session table ensured.");

  const pgStore = new PgSession({
    pool,
    tableName: "user_sessions",
    errorLog: console.error.bind(console, "Session store error:"),
  });

  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET environment variable is required in production",
    );
  }

  app.use(
    session({
      store: pgStore,
      secret:
        process.env.SESSION_SECRET || "text-intelligence-studio-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProduction || !!process.env.REPLIT_DEV_DOMAIN,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  console.log(
    `Session configured. Secure cookies: ${isProduction || !!process.env.REPLIT_DEV_DOMAIN}`,
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUserById(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  if (googleEnabled) {
    const CALLBACK_PATH = "/auth/google/callback";

    const getCallbackURL = () => {
      if (process.env.NODE_ENV === "production") {
        const prodDomain = (process.env.REPLIT_DOMAINS || "")
          .split(",")[0]
          ?.trim();
        // CHANGED: updated fallback from textsurgeonplus.xyz to this app's production domain
        return `https://${prodDomain || "smartgoaltrackerxyz.replit.app"}${CALLBACK_PATH}`;
      }
      if (process.env.REPLIT_DEV_DOMAIN) {
        return `https://${process.env.REPLIT_DEV_DOMAIN}${CALLBACK_PATH}`;
      }
      return `http://localhost:5000${CALLBACK_PATH}`;
    };

    // CHANGED: trustedHosts updated to this app's production domains
    const trustedHosts = new Set<string>(
      [
        ...(process.env.REPLIT_DOMAINS || "").split(",").map((d) => d.trim()),
        process.env.REPLIT_DEV_DOMAIN || "",
        "smartgoaltrackerxyz.replit.app",
        "www.smartgoaltrackerxyz.replit.app",
        "localhost:5000",
      ]
        .filter(Boolean)
        .map((h) => h.toLowerCase()),
    );

    const getRequestCallbackURL = (req: any) => {
      const host = (req.headers["x-forwarded-host"] || req.headers.host || "")
        .toString()
        .split(",")[0]
        .trim()
        .toLowerCase();
      if (host && trustedHosts.has(host)) {
        const proto = host.startsWith("localhost") ? "http" : "https";
        return `${proto}://${host}${CALLBACK_PATH}`;
      }
      return getCallbackURL();
    };

    passport.use(
      new GoogleStrategy(
        {
          clientID,
          clientSecret,
          callbackURL: getCallbackURL(),
          state: true,
          passReqToCallback: false,
        } as any,
        async (accessToken, refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value || null;
            const displayName = profile.displayName || null;
            const googleId = profile.id;

            let user = await storage.getUserByGoogleId(googleId);

            if (!user) {
              if (email) {
                user = await storage.getUserByEmail(email);
              }

              if (!user) {
                const username =
                  email?.split("@")[0] ||
                  `user_${googleId.substring(0, 8)}`;
                user = await storage.createUserWithGoogle({
                  username,
                  googleId,
                  email,
                  displayName,
                });
                console.log(
                  `Google OAuth: Created new user ${user.id} (${user.username})`,
                );
              } else {
                user = await storage.updateUserGoogle(user.id, {
                  googleId,
                  displayName,
                });
              }
            } else {
              user = await storage.updateUserGoogle(user.id, {
                displayName,
              });
            }

            console.log(`Google OAuth: Login successful for user ${user.id}`);
            done(null, user);
          } catch (error) {
            console.error("Google auth error:", error);
            done(error as Error);
          }
        },
      ),
    );

    const loginHandler = (req: any, res: any, next: any) =>
      passport.authenticate("google", {
        scope: ["openid", "email", "profile"],
        prompt: "select_account",
        callbackURL: getRequestCallbackURL(req),
      } as any)(req, res, next);
    app.get("/api/auth/google", loginHandler);
    app.get("/auth/google", loginHandler);

    const callbackHandler = [
      (req: any, res: any, next: any) =>
        passport.authenticate("google", {
          failureRedirect: "/?error=auth_failed",
          callbackURL: getRequestCallbackURL(req),
        } as any)(req, res, next),
      (req: any, res: any) => {
        (async () => {
          try {
            if (req.user) {
              await storage.recordVisit(req.user.id, req.user.email ?? null);
            }
          } catch (visitErr) {
            console.error("Failed to record login event:", visitErr);
          }
        })();
        req.session.save(() => {
          res.redirect("/");
        });
      },
    ];
    app.get(CALLBACK_PATH, ...callbackHandler);
    app.get("/api/auth/google/callback", ...callbackHandler);

    console.log("Google OAuth configured. Callback URL:", getCallbackURL());
  }

  app.get("/api/auth/user", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      res.json({
        authenticated: true,
        user: {
          id: req.user.id,
          username: req.user.username,
          email: req.user.email,
          displayName: req.user.displayName,
        },
      });
    } else {
      res.json({ authenticated: false, user: null });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated() && req.user) {
      res.json({
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        displayName: req.user.displayName,
      });
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        res.status(500).json({ error: "Logout failed" });
        return;
      }
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ success: true });
      });
    });
  });

  app.get("/api/admin/visits", isAdmin, async (_req, res) => {
    try {
      const now = Date.now();
      const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const yearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000);

      const [visitList, allTimestamps] = await Promise.all([
        storage.getVisits(500),
        storage.getVisitTimestampsSince(null),
      ]);

      const times = allTimestamps.map((t) => new Date(t).getTime());
      const stats = {
        allTime: times.length,
        last24Hours: times.filter((t) => t >= dayAgo.getTime()).length,
        lastWeek: times.filter((t) => t >= weekAgo.getTime()).length,
        lastMonth: times.filter((t) => t >= monthAgo.getTime()).length,
        lastYear: times.filter((t) => t >= yearAgo.getTime()).length,
      };

      const buildSeries = (
        start: number,
        bucketMs: number,
        buckets: number,
        labelFn: (d: Date) => string,
      ) => {
        const counts = new Array(buckets).fill(0);
        for (const t of times) {
          if (t >= start) {
            const idx = Math.min(
              Math.floor((t - start) / bucketMs),
              buckets - 1,
            );
            counts[idx]++;
          }
        }
        return counts.map((count, i) => ({
          label: labelFn(new Date(start + i * bucketMs)),
          count,
        }));
      };

      const HOUR = 60 * 60 * 1000;
      const DAY = 24 * HOUR;
      const series = {
        last24Hours: buildSeries(now - 24 * HOUR, HOUR, 24, (d) =>
          d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true }),
        ),
        lastWeek: buildSeries(now - 7 * DAY, DAY, 7, (d) =>
          d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        ),
        lastMonth: buildSeries(now - 30 * DAY, DAY, 30, (d) =>
          d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        ),
        lastYear: buildSeries(
          now - 365 * DAY,
          (365 / 12) * DAY,
          12,
          (d) =>
            d.toLocaleDateString("en-US", {
              month: "short",
              year: "2-digit",
            }),
        ),
        allTime: (() => {
          const earliest = times.length ? Math.min(...times) : now;
          const span = Math.max(now - earliest, DAY);
          const buckets = Math.min(
            24,
            Math.max(6, Math.ceil(span / (30 * DAY))),
          );
          return buildSeries(earliest, span / buckets, buckets, (d) =>
            d.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "2-digit",
            }),
          );
        })(),
      };

      res.json({
        stats,
        series,
        visits: visitList.map((v) => ({
          id: v.id,
          email: v.email,
          visitedAt: v.visitedAt,
        })),
      });
    } catch (error) {
      console.error("Admin visits error:", error);
      res.status(500).json({ error: "Failed to load visitor data" });
    }
  });
}

const ADMIN_EMAIL = "johnmichaelkuczynski@gmail.com";

export const isAdmin: RequestHandler = (req, res, next) => {
  if (
    req.isAuthenticated() &&
    req.user?.email?.toLowerCase() === ADMIN_EMAIL
  ) {
    return next();
  }
  res.status(403).json({ error: "Not authorized" });
};

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
};

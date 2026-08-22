import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Express, RequestHandler } from "express";
import pg from "pg";
import { storage } from "./authStorage";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
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

const CALLBACK_PATH = "/api/auth/google/callback";

function getGoogleCredentials() {
  const clean = (value?: string) =>
    (value || "").replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "").trim();
  return {
    clientID: clean(
      process.env.GOOGLE_CLIENT_ID ||
        process.env.GOOGLE_LOGIN_CLIENT_ID ||
        process.env.GOOGLE_OAUTH_CLIENT_ID ||
        "",
    ),
    clientSecret: clean(
      process.env.GOOGLE_CLIENT_SECRET ||
        process.env.GOOGLE_LOGIN_CLIENT_SECRET ||
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
        "",
    ),
  };
}

function fallbackCallbackUrl() {
  const domain = (process.env.REPLIT_DOMAINS || "").split(",")[0]?.trim();
  if (domain) return `https://${domain}${CALLBACK_PATH}`;
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}${CALLBACK_PATH}`;
  }
  return `http://localhost:8080${CALLBACK_PATH}`;
}

function requestCallbackUrl(req: any) {
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
  if (host && allowedHosts.has(host)) {
    return `${host.startsWith("localhost") ? "http" : "https"}://${host}${CALLBACK_PATH}`;
  }
  return fallbackCallbackUrl();
}

export async function setupAuth(app: Express): Promise<void> {
  const { clientID, clientSecret } = getGoogleCredentials();
  const googleEnabled = Boolean(clientID && clientSecret);
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required");
  }

  const PgSession = connectPgSimple(session);
  const pool = new pg.Pool({
    connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  pool.on("error", (error: Error) => console.error("Session pool error:", error));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "user_sessions" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
    );
    CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire" ON "user_sessions" ("expire");
  `);

  const isProduction = process.env.NODE_ENV === "production";
  app.use(
    session({
      store: new PgSession({ pool, tableName: "user_sessions" }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProduction || Boolean(process.env.REPLIT_DEV_DOMAIN),
        httpOnly: true,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      done(null, await storage.getUserById(id));
    } catch (error) {
      done(error);
    }
  });

  if (googleEnabled) {
    passport.use(
      new GoogleStrategy(
        {
          clientID,
          clientSecret,
          callbackURL: fallbackCallbackUrl(),
          state: true,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value || null;
            const displayName = profile.displayName || null;
            let user = await storage.getUserByGoogleId(profile.id);
            if (!user && email) user = await storage.getUserByEmail(email);
            if (!user) {
              user = await storage.createUserWithGoogle({
                username: email?.split("@")[0] || `user_${profile.id.slice(0, 8)}`,
                googleId: profile.id,
                email,
                displayName,
              });
            } else {
              user = await storage.updateUserGoogle(user.id, {
                googleId: profile.id,
                displayName,
              });
            }
            done(null, user);
          } catch (error) {
            done(error as Error);
          }
        },
      ),
    );

    const login = (req: any, res: any, next: any) =>
      passport.authenticate("google", {
        scope: ["openid", "email", "profile"],
        prompt: "select_account",
        callbackURL: requestCallbackUrl(req),
      } as any)(req, res, next);
    app.get("/api/auth/google", login);
    app.get("/auth/google", login);
    app.get(
      CALLBACK_PATH,
      (req: any, res: any, next: any) =>
        passport.authenticate("google", {
          failureRedirect: "/?error=auth_failed",
          callbackURL: requestCallbackUrl(req),
        } as any)(req, res, next),
      (req: any, res: any) => {
        if (req.user) {
          void storage.recordVisit(req.user.id, req.user.email ?? null);
        }
        req.session.save(() => res.redirect("/"));
      },
    );
  }

  app.get("/api/auth/user", (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      res.json({ authenticated: false, user: null });
      return;
    }
    res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        displayName: req.user.displayName,
      },
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json(req.user);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((error) => {
      if (error) {
        res.status(500).json({ error: "Logout failed" });
        return;
      }
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ success: true });
      });
    });
  });
}

const ADMIN_EMAIL = "johnmichaelkuczynski@gmail.com";

export const isAdmin: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated() && req.user?.email?.toLowerCase() === ADMIN_EMAIL) {
    next();
    return;
  }
  res.status(403).json({ error: "Not authorized" });
};
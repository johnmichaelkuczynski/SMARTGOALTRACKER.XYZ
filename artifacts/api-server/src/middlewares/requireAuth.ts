import type { Request, Response, NextFunction } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Prefer Passport session auth (Google OAuth)
  if (req.isAuthenticated() && req.user) {
    req.userId = req.user.id.toString();
    return next();
  }
  // Fall back to device UUID bearer token (anonymous access)
  const auth = req.headers.authorization;
  const deviceId = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!deviceId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = deviceId;
  next();
}

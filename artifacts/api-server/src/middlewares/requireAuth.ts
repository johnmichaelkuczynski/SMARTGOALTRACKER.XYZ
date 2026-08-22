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
  if (req.isAuthenticated() && req.user) {
    req.userId = String(req.user.id);
    next();
    return;
  }
  res.status(401).json({ error: "Google sign-in required" });
}
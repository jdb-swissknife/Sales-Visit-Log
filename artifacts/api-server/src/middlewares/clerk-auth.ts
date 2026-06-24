/**
 * Clerk auth middleware for Express 5. Verifies the Clerk session JWT from
 * either the __session cookie or the Authorization: Bearer header.
 *
 * Two layers:
 *   1. clerkContext (global, loose) — parses the token and attaches req.auth,
 *      but does NOT reject unauthenticated requests.
 *   2. requireAuth (per-route) — rejects 401 if no valid session. Also
 *      resolves the user's role from Clerk publicMetadata and attaches
 *      req.userId + req.userRole.
 *
 * Roles (stored in Clerk publicMetadata.role):
 *   owner        — full access + billing
 *   admin        — team management + all reps' data
 *   sales_leader — read all reps' pipeline data
 *   rep          — shared data + own pipeline only (default)
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Types — extend Express Request
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: UserRole;
      repName?: string;
    }
  }
}

export type UserRole = "owner" | "admin" | "sales_leader" | "rep";

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  owner: 4,
  admin: 3,
  sales_leader: 2,
  rep: 1,
};

export function canSeeAllReps(role: UserRole | undefined): boolean {
  return role != null && ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.sales_leader;
}

// ---------------------------------------------------------------------------
// JWT verification (lightweight, no Clerk SDK dependency at runtime)
// ---------------------------------------------------------------------------

/**
 * The Clerk session token is a JWT. We verify it against Clerk's JWKS
 * endpoint. This avoids pulling in the full Clerk SDK and works with
 * Express 5 cleanly.
 */

let jwksCache: { keys: Record<string, CryptoKey>; exp: number } | null = null;

async function getClerkJwks(): Promise<Record<string, CryptoKey>> {
  const now = Date.now();
  if (jwksCache && jwksCache.exp > now) return jwksCache.keys;

  const jwksUrl = `https://${process.env.CLERK_HOSTNAME ?? "clerk.example.com"}/.well-known/jwks.json`;
  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status}`);
  const data = (await res.json()) as { keys: Array<{ kid: string; kty: string; n: string; e: string; alg: string }> };

  const keys: Record<string, CryptoKey> = {};
  for (const jwk of data.keys) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, key_ops: ["verify"] },
        { name: "RS256", hash: "SHA-256" },
        false,
        ["verify"],
      );
      keys[jwk.kid] = cryptoKey;
    } catch {
      // skip bad keys
    }
  }
  jwksCache = { keys, exp: now + 3600_000 }; // cache 1 hour
  return keys;
}

interface JwtPayload {
  sub: string; // Clerk user ID
  sid?: string; // session ID
  iss?: string;
  iat?: number;
  exp?: number;
  public_metadata?: Record<string, unknown>;
  private_metadata?: Record<string, unknown>;
}

function extractToken(req: Request): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = req.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  // 2. __session cookie
  const cookie = req.get("cookie");
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)__session=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const [headerB64] = token.split(".");
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString()) as { kid?: string; alg: string };
    if (header.alg !== "RS256") return null;

    const keys = await getClerkJwks();
    const key = header.kid ? keys[header.kid] : Object.values(keys)[0];
    if (!key) return null;

    const parts = token.split(".");
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = Buffer.from(parts[2], "base64url");

    const valid = await crypto.subtle.verify("RS256", key, sig, data);
    if (!valid) return null;

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as JwtPayload;
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Loose middleware: parse the session token if present, attach userId/role.
 * Does NOT reject unauthenticated requests. Apply globally.
 */
export async function clerkContext(req: Request, _res: Response, next: NextFunction): Promise<void> {
  // Dev/test bypass: when NODE_ENV is test or development (and not production),
  // allow mock users via headers. This lets you test locally before Clerk keys
  // are configured. In production, these headers are ignored.
  if (process.env.NODE_ENV !== "production") {
    const testUser = req.get("x-test-user-id");
    if (testUser) {
      req.userId = testUser;
      req.userRole = (req.get("x-test-user-role") as UserRole) ?? "rep";
      req.repName = req.get("x-test-user-name") ?? "Test User";
    }
  }

  if (!req.userId) {
    const token = extractToken(req);
    if (token) {
      const payload = await verifyToken(token);
      if (payload) {
        req.userId = payload.sub;
        const role = payload.public_metadata?.role;
        req.userRole = (typeof role === "string" && ["owner", "admin", "sales_leader", "rep"].includes(role))
          ? role as UserRole
          : "rep";
      }
    }
  }
  next();
}

/**
 * Strict middleware: require a valid Clerk session. Also fetches the user's
 * display name from Clerk's API and attaches it as repName.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Resolve display name (cached, best-effort)
  if (!req.repName) {
    try {
      req.repName = await resolveUserName(req.userId);
    } catch {
      req.repName = "Unknown";
    }
  }

  next();
}

/**
 * Require a minimum role level. Must run after requireAuth.
 */
export function requireRole(minRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.userRole ?? "rep";
    if (ROLE_HIERARCHY[role] < ROLE_HIERARCHY[minRole]) {
      res.status(403).json({ error: `Requires ${minRole} role or higher` });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// User name resolution (cached)
// ---------------------------------------------------------------------------

const nameCache = new Map<string, { name: string; exp: number }>();

async function resolveUserName(userId: string): Promise<string> {
  const cached = nameCache.get(userId);
  if (cached && cached.exp > Date.now()) return cached.name;

  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return "Unknown";

  const hostname = process.env.CLERK_HOSTNAME ?? "api.clerk.com";
  const res = await fetch(`https://${hostname.replace(/^https?:\/\//, "")}/v1/users/${userId}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return "Unknown";

  const data = (await res.json()) as {
    first_name?: string | null;
    last_name?: string | null;
    username?: string | null;
  };
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || data.username || "Unknown";
  nameCache.set(userId, { name, exp: Date.now() + 300_000 }); // cache 5 min
  return name;
}

/**
 * Reset the name cache (for testing).
 */
export function _resetNameCache(): void {
  nameCache.clear();
}

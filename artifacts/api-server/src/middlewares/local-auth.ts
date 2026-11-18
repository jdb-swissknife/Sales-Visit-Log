import type { Request, Response, NextFunction } from "express";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type UserRole = "owner" | "admin" | "sales_leader" | "rep";
declare global {
  namespace Express {
    interface Request { userId?: string; userRole?: UserRole; repName?: string; }
  }
}
export const ROLE_HIERARCHY: Record<UserRole, number> = { owner: 4, admin: 3, sales_leader: 2, rep: 1 };
export const canSeeAllReps = (role: UserRole | undefined) => role != null && ROLE_HIERARCHY[role] >= 2;
export interface LocalUser { id: string; username: string; name: string; role: UserRole; passwordHash: string; sessionVersion: number; disabled?: boolean; }
interface AuthConfig { sessionSecret: string; users: LocalUser[]; }
const configPath = process.env.SVL_AUTH_FILE || "/root/.config/svl/local-auth.json";
const COOKIE = "svl_session";
const TTL = 60 * 60 * 24 * 7;
export function readAuthConfig(): AuthConfig {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as AuthConfig;
  if (!cfg.sessionSecret || cfg.sessionSecret.length < 32 || !Array.isArray(cfg.users)) throw new Error("SVL local auth is not configured");
  return cfg;
}
// Fail closed at startup if persistent credentials are unavailable.
readAuthConfig();
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, encoded: string): boolean {
  try {
    const [kind, salt, hex] = encoded.split(":");
    if (kind !== "scrypt" || !salt || !hex) return false;
    const expected = Buffer.from(hex, "hex");
    const actual = scryptSync(password, salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
export function publicUser(user: LocalUser) { return { id: user.id, username: user.username, name: user.name, role: user.role }; }
function signature(body: string, secret: string) { return createHmac("sha256", secret).update(body).digest("base64url"); }
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
export function issueSession(res: Response, user: LocalUser): void {
  const body = Buffer.from(JSON.stringify({ sub: user.id, version: user.sessionVersion, exp: Math.floor(Date.now() / 1000) + TTL })).toString("base64url");
  res.cookie(COOKIE, `${body}.${signature(body, readAuthConfig().sessionSecret)}`, { ...cookieOptions, maxAge: TTL * 1000 });
}
export function clearSession(res: Response): void { res.clearCookie(COOKIE, cookieOptions); }
export function currentUser(req: Request): LocalUser | undefined { return readAuthConfig().users.find(u => u.id === req.userId && !u.disabled); }
export function sessionContext(req: Request, _res: Response, next: NextFunction): void {
  const token = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (token) {
    try {
      const [body, sig, extra] = token.split(".");
      if (!body || !sig || extra || token.length > 4096) throw new Error("Invalid session");
      const cfg = readAuthConfig();
      const expected = Buffer.from(signature(body, cfg.sessionSecret));
      const supplied = Buffer.from(sig);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid signature");
      const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (typeof data.exp !== "number" || data.exp <= Math.floor(Date.now() / 1000)) throw new Error("Expired session");
      const user = cfg.users.find(u => u.id === data.sub && u.sessionVersion === data.version && !u.disabled);
      if (user && Object.hasOwn(ROLE_HIERARCHY, user.role)) { req.userId = user.id; req.userRole = user.role; req.repName = user.name; }
    } catch { /* Invalid cookies never authenticate. No test-header or Clerk fallback. */ }
  }
  next();
}
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId || !req.userRole) { res.status(401).json({ error: "Authentication required" }); return; }
  next();
}
export function requireRole(minRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userRole || ROLE_HIERARCHY[req.userRole] < ROLE_HIERARCHY[minRole]) { res.status(403).json({ error: `Requires ${minRole} role or higher` }); return; }
    next();
  };
}
export function updatePassword(userId: string, password: string): LocalUser {
  const cfg = readAuthConfig();
  const user = cfg.users.find(u => u.id === userId && !u.disabled);
  if (!user) throw new Error("Account unavailable");
  user.passwordHash = hashPassword(password);
  user.sessionVersion += 1;
  const tmp = `${configPath}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(tmp, configPath);
  return user;
}
// Retained solely for old test imports; there is no external name lookup.
export function _resetNameCache(): void {}

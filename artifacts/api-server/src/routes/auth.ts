import { Router, type IRouter } from "express";
import { readAuthConfig, verifyPassword, hashPassword, issueSession, clearSession, currentUser, publicUser, requireAuth, updatePassword } from "../middlewares/local-auth";
const router: IRouter = Router();
const dummyHash = hashPassword("not-a-real-login-password");
const attempts = new Map<string, { count: number; until: number }>();
router.use("/auth", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.post("/auth/login", (req, res) => {
  const ip = req.get("cf-connecting-ip") || req.ip || "unknown";
  const now = Date.now();
  for (const [key, val] of attempts) if (val.until <= now) attempts.delete(key);
  if (attempts.size > 10000) { res.status(429).json({ error: "Please try again later" }); return; }
  const entry = attempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
  if (entry.count >= 10) { res.set("Retry-After", String(Math.ceil((entry.until - now) / 1000))); res.status(429).json({ error: "Too many attempts. Please try again in 15 minutes." }); return; }
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string" || username.length > 100 || password.length > 256) { res.status(400).json({ error: "Enter your username and password" }); return; }
  const user = readAuthConfig().users.find(u => u.username.toLowerCase() === username.trim().toLowerCase() && !u.disabled);
  const valid = verifyPassword(password, user?.passwordHash || dummyHash);
  if (!user || !valid) { entry.count++; attempts.set(ip, entry); res.status(401).json({ error: "Incorrect username or password" }); return; }
  attempts.delete(ip);
  issueSession(res, user);
  res.json({ user: publicUser(user) });
});
router.get("/auth/me", requireAuth, (req, res) => {
  const user = currentUser(req);
  if (!user) { res.status(401).json({ error: "Authentication required" }); return; }
  res.json({ user: publicUser(user) });
});
router.post("/auth/logout", (_req, res) => { clearSession(res); res.json({ ok: true }); });
router.post("/auth/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || currentPassword.length > 256 || typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 256) { res.status(400).json({ error: "Choose a password of 12–256 characters" }); return; }
  const user = currentUser(req);
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) { res.status(401).json({ error: "Current password is incorrect" }); return; }
  const updated = updatePassword(user.id, newPassword);
  issueSession(res, updated);
  res.json({ ok: true });
});
export default router;

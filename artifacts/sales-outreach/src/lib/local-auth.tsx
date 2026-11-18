import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
export interface LocalUser { id: string; username: string; name: string; role: string; }
interface AuthValue { user: LocalUser | null; loading: boolean; error: string; refresh: () => Promise<void>; signIn: (username: string, password: string) => Promise<void>; signOut: () => Promise<void>; }
const AuthContext = createContext<AuthValue | null>(null);
async function authRequest(path: string, body?: object) {
  const res = await fetch(`/api/auth/${path}`, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Unable to sign in");
  return data;
}
export function LocalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function refresh() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) { setUser(null); return; }
      if (!res.ok) throw new Error("Sign-in is temporarily unavailable. Please try again.");
      setUser((await res.json()).user);
    } catch (e) { setUser(null); setError(e instanceof Error ? e.message : "Unable to connect"); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if ("caches" in window) void caches.delete("api-cache");
    void refresh();
  }, []);
  async function signIn(username: string, password: string) { const data = await authRequest("login", { username, password }); setError(""); setUser(data.user); }
  async function signOut() {
    try { await authRequest("logout", {}); }
    catch { setError("Sign-out failed. Please try again."); return; }
    setUser(null);
    if ("caches" in window) await caches.delete("api-cache");
    window.location.assign("/sign-in");
  }
  return <AuthContext.Provider value={{ user, loading, error, refresh, signIn, signOut }}>{children}</AuthContext.Provider>;
}
export function useLocalAuth() { const ctx = useContext(AuthContext); if (!ctx) throw new Error("LocalAuthProvider is required"); return ctx; }
export async function changePassword(currentPassword: string, newPassword: string) { return authRequest("password", { currentPassword, newPassword }); }

import { useState, type FormEvent } from "react";
import { MapPin } from "lucide-react";
import { useLocalAuth, changePassword } from "@/lib/local-auth";
const inputStyle = "w-full rounded-lg border border-border bg-background px-3 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary";
export function LocalSignIn() {
  const { signIn, error: connectionError, refresh } = useLocalAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await signIn(email, password); setPassword(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to sign in"); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-background flex items-center justify-center p-5 text-foreground">
    <section className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-xl">
      <div className="flex items-center gap-2 text-primary font-semibold text-xl mb-7"><MapPin /> OutreachLog</div>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-sm text-muted-foreground mt-2 mb-6">Welcome back to Sales Visit Log.</p>
      <form onSubmit={submit} className="space-y-5">
        <div><label htmlFor="email" className="block text-sm font-medium mb-2">Email</label><input id="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={100} className={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></div>
        <div><label htmlFor="password" className="block text-sm font-medium mb-2">Password</label><input id="password" type="password" autoComplete="current-password" required maxLength={256} className={inputStyle} value={password} onChange={e => setPassword(e.target.value)} /></div>
        {(error || connectionError) && <p role="alert" className="text-sm text-red-600">{error || connectionError}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-3 font-semibold disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      {connectionError && <button onClick={() => void refresh()} className="mt-4 text-sm underline">Retry connection</button>}
      <p className="mt-6 text-xs text-muted-foreground">Local account sign-in. Contact your administrator if you need access or a password reset.</p>
    </section>
  </main>;
}
export function LocalAccount() {
  const { user } = useLocalAuth();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage("");
    try { await changePassword(currentPassword, newPassword); setCurrent(""); setNew(""); setMessage("Password updated. Other sessions have been signed out."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Unable to change password"); }
    finally { setBusy(false); }
  }
  return <section className="max-w-md space-y-5"><h1 className="text-2xl font-semibold">Your account</h1><p>{user?.username}</p>
    <form onSubmit={submit} className="space-y-4"><h2 className="text-lg font-medium">Change password</h2>
      <label className="block text-sm">Current password<input aria-label="Current password" type="password" autoComplete="current-password" required maxLength={256} className={inputStyle} value={currentPassword} onChange={e => setCurrent(e.target.value)} /></label>
      <label className="block text-sm">New password<input aria-label="New password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} className={inputStyle} value={newPassword} onChange={e => setNew(e.target.value)} /></label>
      <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>
      <button disabled={busy} className="rounded-lg bg-primary text-primary-foreground px-4 py-3">{busy ? "Saving…" : "Update password"}</button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </form></section>;
}

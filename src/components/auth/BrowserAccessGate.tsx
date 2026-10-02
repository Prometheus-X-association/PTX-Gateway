import { FormEvent, ReactNode, useEffect, useState } from "react";
import { browserAccessKey, browserAccessRequest, getBrowserAccessToken } from "@/lib/browserAccess";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function BrowserAccessGate({ slug, children }: { slug: string; children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => {
    let active = true;
    const check = async (logVisit = false) => {
      try {
        const data = await browserAccessRequest(slug, { action: "check", token: getBrowserAccessToken(slug), log_visit: logVisit });
        if (!active) return;
        setAllowed(data.ok === true);
        setRequired(data.required === true);
        setError("");
        if (data.required && !data.ok) sessionStorage.removeItem(browserAccessKey(slug));
      } catch (e) {
        if (active) { setAllowed(false); setError(e instanceof Error ? e.message : "Access check failed"); }
      } finally { if (active) setLoading(false); }
    };
    void check(true);
    const timer = window.setInterval(() => void check(), 30_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [slug]);
  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const data = await browserAccessRequest(slug, { action: "login", username, password });
      sessionStorage.setItem(browserAccessKey(slug), data.token);
      setPassword(""); setAllowed(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Sign in failed"); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true);
    try {
      await browserAccessRequest(slug, { action: "logout", token: getBrowserAccessToken(slug) });
      sessionStorage.removeItem(browserAccessKey(slug)); setAllowed(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Sign out failed"); }
    finally { setBusy(false); }
  };
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" aria-label="Checking access" /></div>;
  if (allowed) return <>{required && <div className="flex justify-end items-center gap-3 p-2 border-b">{error && <p role="alert" className="text-destructive text-sm">{error}</p>}<Button size="sm" variant="outline" disabled={busy} onClick={logout}>Sign out of gateway</Button></div>}{children}</>;
  return <div className="min-h-screen flex items-center justify-center p-4 bg-background"><Card className="w-full max-w-md"><CardHeader><CardTitle>{required ? "Private gateway" : "Gateway access unavailable"}</CardTitle><CardDescription>{required ? "Enter the username and password provided by your organization." : "Access could not be verified. Reload the page to try again."}</CardDescription></CardHeader><CardContent>{required && <form onSubmit={login} className="space-y-4"><div className="space-y-2"><Label htmlFor="gateway-username">Username</Label><Input id="gateway-username" autoComplete="username" required maxLength={100} value={username} onChange={e => setUsername(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="gateway-password">Password</Label><Input id="gateway-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div><Button disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</Button></form>}{error && <p role="alert" className="text-destructive text-sm mt-4">{error}</p>}</CardContent></Card></div>;
}

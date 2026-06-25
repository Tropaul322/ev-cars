"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AdminLoginStatus = {
  sessionConfigured: boolean;
  supabaseConfigured: boolean;
  hasAdmins: boolean;
};

export function AdminLoginForm({ status }: { status: AdminLoginStatus }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const canLogin =
    status.sessionConfigured && status.supabaseConfigured && status.hasAdmins;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canLogin) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Login failed.");
        return;
      }

      const next = searchParams.get("next") || "/admin/users";
      router.push(next);
      router.refresh();
    } catch {
      setError("Login failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-10">
      <Card className="w-full max-w-md rounded-3xl">
        <CardHeader>
          <CardTitle className="font-display text-2xl font-extrabold">FlowRyd Admin</CardTitle>
          <CardDescription>Enter your admin credentials to access the panel.</CardDescription>
        </CardHeader>
        <CardContent>
          {!status.sessionConfigured ? (
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              Set `ADMIN_SESSION_SECRET` (32+ characters) in `.env.local` before using the admin panel.
            </p>
          ) : !status.supabaseConfigured ? (
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              Supabase is not configured. Add your Supabase URL and service role key to `.env.local`.
            </p>
          ) : !status.hasAdmins ? (
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              No admin users exist yet. Create one with{" "}
              <code className="rounded bg-background px-1 py-0.5">npm run admin:create -- --email you@example.com --password your-password</code>
              .
            </p>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="admin-email">Email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="admin-password">Password</Label>
                <Input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={pending}>
                {pending ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

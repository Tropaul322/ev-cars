"use client";

import { CheckCircle2, Loader2, MapPin, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getDemoRegistrationStatus,
  notifyDemoRegistrationChanged,
  type DemoRegistrationStatus,
} from "@/lib/demo-access-client";

type RegistrationStatus = DemoRegistrationStatus;

const initialStatus: RegistrationStatus = { registered: false };

export function DemoRegistrationGate() {
  const [status, setStatus] = useState<RegistrationStatus>(initialStatus);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [consent, setConsent] = useState(false);

  async function refreshStatus(openAfterRefresh = false) {
    setLoading(true);
    setError(null);
    if (openAfterRefresh) setVisible(true);
    try {
      const nextStatus = await getDemoRegistrationStatus({ refresh: openAfterRefresh });
      setStatus(nextStatus);
      setVisible(openAfterRefresh);
      notifyDemoRegistrationChanged(nextStatus);
    } catch {
      setStatus(initialStatus);
      setVisible(openAfterRefresh);
      setError("Demo registration is temporarily unavailable.");
      notifyDemoRegistrationChanged(initialStatus);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshStatus();

    const openRegistration = () => refreshStatus(true);
    window.addEventListener("flowryd:open-registration", openRegistration);
    return () => window.removeEventListener("flowryd:open-registration", openRegistration);
  }, []);

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/demo-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, location, consent }),
      });
      const data = (await response.json()) as RegistrationStatus & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Registration failed.");
      setStatus(data);
      setVisible(false);
      notifyDemoRegistrationChanged(data);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Registration failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestDeletion() {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/demo-registration", { method: "DELETE" });
      const data = (await response.json()) as RegistrationStatus & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Deletion request failed.");
      setStatus(data);
      setVisible(false);
      notifyDemoRegistrationChanged(data);
    } catch {
      setError("Deletion request could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgb(9_13_26/58%)] p-5 backdrop-blur-[18px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-gate-title"
    >
      <div className="relative max-h-[min(760px,calc(100vh-40px))] w-full max-w-[480px] overflow-auto rounded-lg border border-white/45 bg-background p-6 shadow-[0_30px_80px_rgb(42_47_76/13%)]">
        <button
          className="absolute right-[18px] top-[18px] z-[1] inline-flex size-[34px] items-center justify-center rounded-full bg-muted text-foreground"
          type="button"
          aria-label="Close"
          onClick={() => setVisible(false)}
        >
          <X size={18} aria-hidden="true" />
        </button>
        {loading ? (
          <div className="grid justify-items-center gap-[18px] py-[22px] text-center">
            <Loader2 className="animate-spin" size={22} aria-hidden="true" />
            <p>Checking demo access...</p>
          </div>
        ) : status.registered && status.tester ? (
          <div className="grid gap-[18px]">
            <span className="inline-flex size-[42px] items-center justify-center rounded-full bg-accent text-accent-foreground">
              <CheckCircle2 size={22} aria-hidden="true" />
            </span>
            <div>
              <h2 id="demo-gate-title" className="m-0 text-[1.45rem] leading-[1.12]">
                {status.deletionRequested ? "Deletion requested" : "Demo access active"}
              </h2>
              <p className="mt-2 text-muted-foreground leading-normal">
                {status.tester.name} - {status.tester.email} - {status.tester.location}
              </p>
              {status.deletionRequested ? (
                <p className="mt-2 text-sm text-muted-foreground leading-normal">
                  Your deletion request is recorded. You can keep using the demo until an admin
                  removes your account.
                </p>
              ) : null}
            </div>
            {error ? <p className="text-red-600">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setVisible(false)}>
                Continue
              </Button>
              {!status.deletionRequested ? (
                <Button type="button" variant="destructive" onClick={requestDeletion} disabled={submitting}>
                  <Trash2 size={16} aria-hidden="true" />
                  Request deletion
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <form className="grid gap-[18px]" onSubmit={submitRegistration}>
            <span className="inline-flex size-[42px] items-center justify-center rounded-full bg-accent text-accent-foreground">
              <ShieldCheck size={22} aria-hidden="true" />
            </span>
            <div>
              <h2 id="demo-gate-title" className="m-0 text-[1.45rem] leading-[1.12]">
                Join the FlowRyd demo
              </h2>
              <p className="mt-2 text-muted-foreground leading-normal">
                We collect only name, email, and Austrian location to identify tester sessions and
                improve regional matching.
              </p>
            </div>

            <label className="grid gap-[7px] text-[0.82rem] font-bold text-foreground">
              Name
              <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
            </label>

            <label className="grid gap-[7px] text-[0.82rem] font-bold text-foreground">
              Email
              <Input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                inputMode="email"
                required
                type="email"
              />
            </label>

            <label className="grid gap-[7px] text-[0.82rem] font-bold text-foreground">
              Austrian PLZ or Bundesland
              <div className="relative">
                <MapPin
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  autoComplete="postal-code"
                  placeholder="1010 or Wien"
                  required
                  className="pl-9"
                />
              </div>
            </label>

            <label className="flex items-start gap-3 text-sm font-normal leading-normal">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                required
                className="mt-1"
              />
              <span>
                I consent to FlowRyd storing this minimal tester record for the demo. I can request
                deletion from this screen; no password, SSO, or saved-vehicle account is created.
              </span>
            </label>

            {error ? <p className="text-red-600">{error}</p> : null}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}
              Continue to demo
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

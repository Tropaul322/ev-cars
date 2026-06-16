"use client";

import { CheckCircle2, Loader2, MapPin, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getDemoRegistrationStatus,
  notifyDemoRegistrationChanged,
  type DemoRegistrationStatus
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
        body: JSON.stringify({ name, email, location, consent })
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
      await fetch("/api/demo-registration", { method: "DELETE" });
      setStatus(initialStatus);
      setName("");
      setEmail("");
      setLocation("");
      setConsent(false);
      setVisible(true);
      notifyDemoRegistrationChanged(initialStatus);
    } catch {
      setError("Deletion request could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="demo-gate" role="dialog" aria-modal="true" aria-labelledby="demo-gate-title">
      <div className="demo-gate-panel">
        <button
          className="demo-gate-close"
          type="button"
          aria-label="Close"
          onClick={() => setVisible(false)}
        >
          <X size={18} aria-hidden="true" />
        </button>
        {loading ? (
          <div className="demo-gate-loading">
            <Loader2 className="demo-gate-spinner" size={22} aria-hidden="true" />
            <p>Checking demo access...</p>
          </div>
        ) : status.registered && status.tester ? (
          <div className="demo-gate-status">
            <span className="demo-gate-icon">
              <CheckCircle2 size={22} aria-hidden="true" />
            </span>
            <div>
              <h2 id="demo-gate-title">Demo access active</h2>
              <p>
                {status.tester.name} - {status.tester.email} - {status.tester.location}
              </p>
            </div>
            {error ? <p className="demo-gate-error">{error}</p> : null}
            <div className="demo-gate-actions">
              <Button type="button" variant="secondary" onClick={() => setVisible(false)}>
                Continue
              </Button>
              <Button type="button" variant="danger" onClick={requestDeletion} disabled={submitting}>
                <Trash2 size={16} aria-hidden="true" />
                Request deletion
              </Button>
            </div>
          </div>
        ) : (
          <form className="demo-gate-form" onSubmit={submitRegistration}>
            <span className="demo-gate-icon">
              <ShieldCheck size={22} aria-hidden="true" />
            </span>
            <div>
              <h2 id="demo-gate-title">Join the FlowRyd demo</h2>
              <p>
                We collect only name, email, and Austrian location to identify tester sessions and improve regional
                matching.
              </p>
            </div>

            <label>
              Name
              <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
            </label>

            <label>
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

            <label>
              Austrian PLZ or Bundesland
              <div className="demo-gate-location">
                <MapPin size={16} aria-hidden="true" />
                <Input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  autoComplete="postal-code"
                  placeholder="1010 or Wien"
                  required
                />
              </div>
            </label>

            <label className="demo-gate-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                required
              />
              <span>
                I consent to FlowRyd storing this minimal tester record for the demo. I can request deletion from this
                screen; no password, SSO, or saved-vehicle account is created.
              </span>
            </label>

            {error ? <p className="demo-gate-error">{error}</p> : null}

            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="demo-gate-spinner" size={16} aria-hidden="true" /> : null}
              Continue to demo
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

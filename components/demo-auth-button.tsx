"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getDemoRegistrationStatus,
  openDemoRegistration,
  type DemoRegistrationStatus
} from "@/lib/demo-access-client";

function demoAuthLabel(status: DemoRegistrationStatus) {
  if (!status.registered) return "Join demo";
  const firstName = status.tester?.name.trim().split(/\s+/)[0];
  return firstName || "Demo active";
}

export function DemoAuthButton({ shell = false }: { shell?: boolean }) {
  const [status, setStatus] = useState<DemoRegistrationStatus>({ registered: false });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function refresh() {
      const nextStatus = await getDemoRegistrationStatus();
      setStatus(nextStatus);
      setReady(true);
    }

    void refresh();
    window.addEventListener("flowryd:registration-changed", refresh);
    return () => window.removeEventListener("flowryd:registration-changed", refresh);
  }, []);

  if (!ready) {
    return <span className={shell ? "flow-auth-placeholder" : "demo-auth-placeholder"} aria-hidden="true" />;
  }

  const label = demoAuthLabel(status);

  if (shell) {
    return (
      <button
        className={status.registered ? "flow-auth-link" : "flow-auth-primary"}
        type="button"
        onClick={openDemoRegistration}
      >
        {label}
      </button>
    );
  }

  return (
    <Button type="button" size="sm" variant={status.registered ? "ghost" : "primary"} onClick={openDemoRegistration}>
      {label}
    </Button>
  );
}

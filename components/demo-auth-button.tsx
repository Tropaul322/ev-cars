"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  getDemoRegistrationStatus,
  openDemoRegistration,
  type DemoRegistrationStatus,
} from "@/lib/demo-access-client";

function demoAuthLabel(status: DemoRegistrationStatus) {
  if (!status.registered) return "Join demo";
  const firstName = status.tester?.name.trim().split(/\s+/)[0];
  return firstName || "Demo active";
}

export function DemoAuthButton({
  shell = false,
  transparentHeader = false,
}: {
  shell?: boolean;
  transparentHeader?: boolean;
}) {
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
    return (
      <span
        className={cn("inline-block h-9 w-20 rounded-full bg-muted/60", shell ? "" : "w-24")}
        aria-hidden="true"
      />
    );
  }

  const label = demoAuthLabel(status);

  if (shell) {
    return (
      <button
        className={cn(
          "px-5 py-2 rounded-full text-sm font-semibold shadow-lg",
          status.registered
            ? transparentHeader
              ? "text-white hover:bg-white/15"
              : "text-foreground hover:bg-muted"
            : "bg-primary text-primary-foreground hover:opacity-95",
        )}
        type="button"
        onClick={openDemoRegistration}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      className={cn(
        "px-4 py-2 rounded-full text-sm font-semibold",
        status.registered
          ? "text-foreground hover:bg-muted"
          : "bg-primary text-primary-foreground hover:opacity-95",
      )}
      type="button"
      onClick={openDemoRegistration}
    >
      {label}
    </button>
  );
}

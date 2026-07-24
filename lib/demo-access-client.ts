"use client";

export type DemoRegistrationStatus = {
  registered: boolean;
  deletionRequested?: boolean;
  tester?: {
    name: string;
    email: string;
    location: string;
  };
};

const unregisteredStatus: DemoRegistrationStatus = { registered: false };
const storageKey = "flowryd.demo-registration";

let cachedStatus: DemoRegistrationStatus | null = null;
let inflightStatus: Promise<DemoRegistrationStatus> | null = null;

function readStoredStatus(): DemoRegistrationStatus | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as DemoRegistrationStatus;
  } catch {
    return null;
  }
}

function writeStoredStatus(status: DemoRegistrationStatus) {
  cachedStatus = status;
  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(storageKey, JSON.stringify(status));
  } catch {
    // Ignore storage quota or privacy mode errors.
  }
}

export function peekDemoRegistrationStatus(): DemoRegistrationStatus | null {
  return cachedStatus ?? readStoredStatus();
}

export function openDemoRegistration() {
  window.dispatchEvent(new Event("flowryd:open-registration"));
}

export function notifyDemoRegistrationChanged(status?: DemoRegistrationStatus) {
  if (status) writeStoredStatus(status);
  window.dispatchEvent(new Event("flowryd:registration-changed"));
}

export async function getDemoRegistrationStatus(options?: { refresh?: boolean }): Promise<DemoRegistrationStatus> {
  if (!options?.refresh) {
    const known = peekDemoRegistrationStatus();
    if (known) return known;
    if (inflightStatus) return inflightStatus;
  }

  inflightStatus = (async () => {
    try {
      const response = await fetch("/api/demo-registration", { cache: "no-store" });
      const status: DemoRegistrationStatus = !response.ok
        ? unregisteredStatus
        : ((await response.json()) as DemoRegistrationStatus);
      writeStoredStatus(status);
      return status;
    } catch {
      writeStoredStatus(unregisteredStatus);
      return unregisteredStatus;
    } finally {
      inflightStatus = null;
    }
  })();

  return inflightStatus;
}

export async function hasDemoAccess() {
  const status = await getDemoRegistrationStatus();
  return status.registered;
}

export async function requireDemoAccess() {
  const registered = await hasDemoAccess();
  if (!registered) openDemoRegistration();
  return registered;
}

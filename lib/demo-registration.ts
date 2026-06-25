import { getSupabaseRestConfig } from "./repositories/supabase-rest.ts";

export const DEMO_REGISTRATION_COOKIE = "flowryd_demo_registration";

const AUSTRIAN_STATES = [
  "burgenland",
  "kaernten",
  "kärnten",
  "niederoesterreich",
  "niederösterreich",
  "oberoesterreich",
  "oberösterreich",
  "salzburg",
  "steiermark",
  "tirol",
  "vorarlberg",
  "wien"
] as const;

export type DemoRegistrationInput = {
  name: string;
  email: string;
  location: string;
  consent: boolean;
};

export type DemoRegistration = {
  id: string;
  name: string;
  email: string;
  location: string;
  consentAt: string;
  deletionRequestedAt: string | null;
};

type RegistrationRow = {
  id: string;
  name: string | null;
  email: string | null;
  location: string | null;
  consent_at: string | null;
  deletion_requested_at: string | null;
};

const localRegistrations = new Map<string, DemoRegistration>();
const REGISTRATION_SELECT = "id,name,email,location,consent_at,deletion_requested_at";

export function validateDemoRegistration(input: DemoRegistrationInput): {
  clean?: DemoRegistrationInput;
  error?: string;
} {
  const clean = {
    name: normalizeWhitespace(input.name),
    email: input.email.trim().toLowerCase(),
    location: normalizeWhitespace(input.location),
    consent: input.consent
  };

  if (clean.name.length < 2 || clean.name.length > 120) {
    return { error: "Please enter your name." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email) || clean.email.length > 180) {
    return { error: "Please enter a valid email address." };
  }
  if (!isAustrianLocation(clean.location)) {
    return { error: "Use an Austrian PLZ or Bundesland." };
  }
  if (!clean.consent) {
    return { error: "Consent is required before the demo." };
  }

  return { clean };
}

export async function createDemoRegistration(input: DemoRegistrationInput): Promise<DemoRegistration> {
  const consentAt = new Date().toISOString();
  const supabase = getSupabaseRestConfig();

  const existingRegistration = supabase
    ? await findRegistrationByEmail(input.email)
    : findLocalRegistrationByEmail(input.email);
  if (existingRegistration) {
    return cacheRegistration(existingRegistration);
  }

  const registration: DemoRegistration = {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email,
    location: input.location,
    consentAt,
    deletionRequestedAt: null
  };

  localRegistrations.set(registration.id, registration);

  if (!supabase) return registration;

  try {
    const response = await fetch(`${supabase.url}/rest/v1/tester_registrations`, {
      method: "POST",
      headers: {
        ...supabase.headers,
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        id: registration.id,
        name: registration.name,
        email: registration.email,
        location: registration.location,
        consent_at: registration.consentAt
      })
    });
    if (!response.ok) return (await findRegistrationByEmail(input.email)) ?? registration;
    const rows = (await response.json()) as RegistrationRow[];
    return cacheRegistration(rowToRegistration(rows[0]) ?? registration);
  } catch {
    return registration;
  }
}

export async function getDemoRegistration(id: string | undefined): Promise<DemoRegistration | null> {
  if (!id) return null;

  const local = localRegistrations.get(id) ?? null;
  const supabase = getSupabaseRestConfig();
  if (!supabase) return local;

  const params = new URLSearchParams({
    select: REGISTRATION_SELECT,
    id: `eq.${id}`,
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/tester_registrations?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 0 }
    });
    if (!response.ok) return local;
    const rows = (await response.json()) as RegistrationRow[];
    return rowToRegistration(rows[0]) ?? local;
  } catch {
    return local;
  }
}

async function findRegistrationByEmail(email: string): Promise<DemoRegistration | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return findLocalRegistrationByEmail(email);

  const params = new URLSearchParams({
    select: REGISTRATION_SELECT,
    email: `eq.${email}`,
    order: "created_at.asc",
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/tester_registrations?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 0 }
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as RegistrationRow[];
    return rowToRegistration(rows[0]);
  } catch {
    return null;
  }
}

function findLocalRegistrationByEmail(email: string): DemoRegistration | null {
  const normalizedEmail = email.trim().toLowerCase();
  return [...localRegistrations.values()].find((registration) => registration.email === normalizedEmail) ?? null;
}

function cacheRegistration(registration: DemoRegistration) {
  localRegistrations.set(registration.id, registration);
  return registration;
}

export async function requestDemoRegistrationDeletion(id: string | undefined): Promise<void> {
  if (!id) return;

  const requestedAt = new Date().toISOString();
  const local = localRegistrations.get(id);
  if (local) {
    localRegistrations.set(id, { ...local, deletionRequestedAt: requestedAt });
  }

  const supabase = getSupabaseRestConfig();
  if (!supabase) return;

  try {
    await fetch(`${supabase.url}/rest/v1/tester_registrations?id=eq.${id}`, {
      method: "PATCH",
      headers: supabase.headers,
      body: JSON.stringify({ deletion_requested_at: requestedAt })
    });
  } catch {
    // The cookie is still cleared by the route so the tester can leave the demo gate.
  }
}

export function isActiveDemoRegistration(registration: DemoRegistration | null) {
  return Boolean(registration?.consentAt);
}

export function hasDeletionRequest(registration: DemoRegistration | null) {
  return Boolean(registration?.deletionRequestedAt);
}

function rowToRegistration(row: RegistrationRow | undefined): DemoRegistration | null {
  if (!row?.id || !row.consent_at || !row.name || !row.email || !row.location) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    location: row.location,
    consentAt: row.consent_at,
    deletionRequestedAt: row.deletion_requested_at
  };
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isAustrianLocation(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[1-9]\d{3}$/.test(normalized) || AUSTRIAN_STATES.includes(normalized as (typeof AUSTRIAN_STATES)[number]);
}

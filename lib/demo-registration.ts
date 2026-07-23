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

export async function createDemoRegistration(
  input: DemoRegistrationInput
): Promise<DemoRegistration | { error: string }> {
  const consentAt = new Date().toISOString();
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    return { error: "Supabase is not configured." };
  }

  const existingRegistration = await findRegistrationByEmail(input.email);
  if (existingRegistration) return existingRegistration;

  const registration: DemoRegistration = {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email,
    location: input.location,
    consentAt,
    deletionRequestedAt: null
  };

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
    if (!response.ok) {
      const existing = await findRegistrationByEmail(input.email);
      if (existing) return existing;
      return { error: await response.text() };
    }
    const rows = (await response.json()) as RegistrationRow[];
    return rowToRegistration(rows[0]) ?? registration;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to create registration."
    };
  }
}

export async function getDemoRegistration(id: string | undefined): Promise<DemoRegistration | null> {
  if (!id) return null;

  const supabase = getSupabaseRestConfig();
  if (!supabase) return null;

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
    if (!response.ok) return null;
    const rows = (await response.json()) as RegistrationRow[];
    return rowToRegistration(rows[0]);
  } catch {
    return null;
  }
}

async function findRegistrationByEmail(email: string): Promise<DemoRegistration | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return null;

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

export async function requestDemoRegistrationDeletion(id: string | undefined): Promise<void> {
  if (!id) return;

  const requestedAt = new Date().toISOString();
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

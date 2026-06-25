import { hashPassword, verifyPassword } from "../password-hash.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  createdAt: string;
};

type AdminUserRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  active: boolean;
  created_at: string;
};

const ADMIN_USER_SELECT = "id,email,password_hash,name,active,created_at";

export async function hasActiveAdminUsers(): Promise<boolean> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return false;

  const params = new URLSearchParams({
    select: "id",
    active: "eq.true",
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/admin_users?${params}`, {
      headers: supabase.headers,
      cache: "no-store"
    });
    if (!response.ok) return false;
    const rows = (await response.json()) as Array<{ id: string }>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function getAdminUserById(id: string): Promise<AdminUser | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return null;

  const params = new URLSearchParams({
    select: "id,email,name,active,created_at",
    id: `eq.${id}`,
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/admin_users?${params}`, {
      headers: supabase.headers,
      cache: "no-store"
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as Array<Omit<AdminUserRow, "password_hash">>;
    return rowToAdminUser(rows[0]);
  } catch {
    return null;
  }
}

export async function findAdminUserByEmail(email: string): Promise<(AdminUser & { passwordHash: string }) | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return null;

  const normalizedEmail = email.trim().toLowerCase();
  const params = new URLSearchParams({
    select: ADMIN_USER_SELECT,
    email: `eq.${normalizedEmail}`,
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/admin_users?${params}`, {
      headers: supabase.headers,
      cache: "no-store"
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as AdminUserRow[];
    const row = rows[0];
    if (!row) return null;

    const user = rowToAdminUser(row);
    if (!user) return null;

    return { ...user, passwordHash: row.password_hash };
  } catch {
    return null;
  }
}

export async function authenticateAdminUser(
  email: string,
  password: string
): Promise<AdminUser | null> {
  const user = await findAdminUserByEmail(email);
  if (!user?.active) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;

  const { passwordHash, ...adminUser } = user;
  void passwordHash;
  return adminUser;
}

export async function createAdminUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AdminUser> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid email is required.");
  }
  if (input.password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const existing = await findAdminUserByEmail(email);
  if (existing) {
    throw new Error("An admin user with this email already exists.");
  }

  const row = {
    email,
    password_hash: hashPassword(input.password),
    name: input.name?.trim() || null,
    active: true
  };

  const response = await fetch(`${supabase.url}/rest/v1/admin_users`, {
    method: "POST",
    headers: {
      ...supabase.headers,
      Prefer: "return=representation"
    },
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    throw new Error(`Failed to create admin user: ${await response.text()}`);
  }

  const rows = (await response.json()) as AdminUserRow[];
  const user = rowToAdminUser(rows[0]);
  if (!user) {
    throw new Error("Failed to create admin user.");
  }

  return user;
}

function rowToAdminUser(row: AdminUserRow | Omit<AdminUserRow, "password_hash"> | undefined): AdminUser | null {
  if (!row?.id || !row.email) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    active: row.active,
    createdAt: row.created_at
  };
}

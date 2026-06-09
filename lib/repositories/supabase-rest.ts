export type SupabaseRestConfig = {
  url: string;
  headers: {
    "Content-Type": string;
    apikey: string;
    Authorization: string;
  };
};

export function getSupabaseRestConfig(): SupabaseRestConfig | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;

  return {
    url: url.replace(/\/$/, ""),
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  };
}

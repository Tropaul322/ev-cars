import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { getAdminSession, isAdminSessionConfigured } from "@/lib/admin-auth";
import { hasActiveAdminUsers } from "@/lib/repositories/admin-user-repository";
import { getSupabaseRestConfig } from "@/lib/repositories/supabase-rest";

export default async function AdminIndexPage() {
  const session = await getAdminSession();
  if (session) {
    redirect("/admin/users");
  }

  const loginStatus = {
    sessionConfigured: isAdminSessionConfigured(),
    supabaseConfigured: Boolean(getSupabaseRestConfig()),
    hasAdmins: await hasActiveAdminUsers()
  };

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
      <AdminLoginForm status={loginStatus} />
    </Suspense>
  );
}

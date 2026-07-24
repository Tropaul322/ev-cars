import { AdminShell } from "@/components/admin/admin-shell";
import { UsersTable } from "@/components/admin/users-table";
import { listAllTesterRegistrations } from "@/lib/repositories/admin-repository";

export default async function AdminUsersPage() {
  const users = await listAllTesterRegistrations();

  return (
    <AdminShell>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-extrabold">Registered users</h1>
        <p className="text-muted-foreground">Demo registrations and their chat activity.</p>
      </div>
      <UsersTable users={users} />
    </AdminShell>
  );
}

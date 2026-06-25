import { AdminPageHeaderSkeleton, AdminTableSkeleton } from "@/components/admin/admin-table-skeleton";
import { AdminShell } from "@/components/admin/admin-shell";

export default function AdminUsersLoading() {
  return (
    <AdminShell>
      <AdminPageHeaderSkeleton />
      <AdminTableSkeleton rows={8} columns={6} />
    </AdminShell>
  );
}

import { AdminPageHeaderSkeleton, AdminTableSkeleton } from "@/components/admin/admin-table-skeleton";
import { AdminShell } from "@/components/admin/admin-shell";

export default function AdminVehiclesLoading() {
  return (
    <AdminShell>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <AdminPageHeaderSkeleton />
        <div className="flex flex-wrap gap-2">
          <div className="h-8 w-36 animate-pulse rounded-lg bg-muted" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
      <AdminTableSkeleton rows={10} columns={5} />
    </AdminShell>
  );
}

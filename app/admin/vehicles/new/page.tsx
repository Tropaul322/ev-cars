import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { VehicleForm } from "@/components/admin/vehicle-form";
import { Button } from "@/components/ui/button";

export default function AdminVehicleNewPage() {
  return (
    <AdminShell>
      <div className="flex flex-col gap-4">
        <Button variant="outline" className="w-fit" nativeButton={false} render={<Link href="/admin/vehicles" />}>
          Back to vehicles
        </Button>
        <VehicleForm mode="create" />
      </div>
    </AdminShell>
  );
}

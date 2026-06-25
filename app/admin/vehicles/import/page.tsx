import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { VehicleCsvImport } from "@/components/admin/vehicle-csv-import";
import { Button } from "@/components/ui/button";

export default function AdminVehicleImportPage() {
  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <Button variant="outline" className="w-fit" nativeButton={false} render={<Link href="/admin/vehicles" />}>
          Back to vehicles
        </Button>
        <VehicleCsvImport />
      </div>
    </AdminShell>
  );
}

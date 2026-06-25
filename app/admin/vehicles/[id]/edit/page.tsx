import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { VehicleForm } from "@/components/admin/vehicle-form";
import { Button } from "@/components/ui/button";
import { decodeVehicleRouteId } from "@/lib/admin-vehicle-helpers";
import { getVehicleAdmin } from "@/lib/repositories/admin-vehicle-repository";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminVehicleEditPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = decodeVehicleRouteId(rawId);
  const vehicle = await getVehicleAdmin(id);
  if (!vehicle) notFound();

  return (
    <AdminShell>
      <div className="flex flex-col gap-4">
        <Button variant="outline" className="w-fit" nativeButton={false} render={<Link href="/admin/vehicles" />}>
          Back to vehicles
        </Button>
        <VehicleForm mode="edit" initialVehicle={vehicle} />
      </div>
    </AdminShell>
  );
}

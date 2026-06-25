"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { AdminVehicleListItem } from "@/lib/repositories/admin-vehicle-repository";
import { adminVehicleApiPath, adminVehicleEditPath } from "@/lib/admin-vehicle-helpers";
import { formatEUR } from "@/lib/utils";

export function VehiclesTable({
  vehicles,
  onDeactivate,
  onActivate
}: {
  vehicles: AdminVehicleListItem[];
  onDeactivate: (id: string) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleDeactivate(id: string) {
    setPendingId(id);
    try {
      await onDeactivate(id);
      toast.success("Vehicle deactivated.");
    } catch {
      toast.error("Failed to deactivate vehicle.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleActivate(id: string) {
    setPendingId(id);
    try {
      await onActivate(id);
      toast.success("Vehicle activated.");
    } catch {
      toast.error("Failed to activate vehicle.");
    } finally {
      setPendingId(null);
    }
  }

  if (!vehicles.length) {
    return (
      <div className="rounded-3xl bg-muted px-6 py-10 text-center text-muted-foreground">
        No vehicles found.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vehicle</TableHead>
            <TableHead>Year</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vehicles.map((vehicle) => (
            <TableRow key={vehicle.id}>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <Link href={adminVehicleEditPath(vehicle.id)} className="font-medium hover:underline">
                    {vehicle.make} {vehicle.model}
                  </Link>
                  <span className="text-xs text-muted-foreground">{vehicle.id}</span>
                </div>
              </TableCell>
              <TableCell>{vehicle.year}</TableCell>
              <TableCell>{formatEUR(vehicle.priceEUR)}</TableCell>
              <TableCell>{vehicle.location ?? "—"}</TableCell>
              <TableCell>
                {vehicle.available ? (
                  <Badge variant="secondary">Available</Badge>
                ) : (
                  <Badge variant="outline">Unavailable</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={adminVehicleEditPath(vehicle.id)} />}
                  >
                    Edit
                  </Button>
                  {vehicle.available ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={pendingId === vehicle.id}
                      onClick={() => handleDeactivate(vehicle.id)}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pendingId === vehicle.id}
                      onClick={() => handleActivate(vehicle.id)}
                    >
                      Activate
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

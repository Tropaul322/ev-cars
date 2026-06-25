"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminTableSkeleton } from "@/components/admin/admin-table-skeleton";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  AdminVehiclesFilters,
  type AdminVehicleFilters
} from "@/components/admin/vehicles-filters";
import { AdminVehiclesPagination } from "@/components/admin/vehicles-pagination";
import { VehiclesTable } from "@/components/admin/vehicles-table";
import { Button } from "@/components/ui/button";
import type {
  AdminVehicleListItem,
  AdminVehicleListResult
} from "@/lib/repositories/admin-vehicle-repository";
import { adminVehicleApiPath } from "@/lib/admin-vehicle-helpers";

const DEFAULT_FILTERS: AdminVehicleFilters = {
  q: "",
  make: "",
  location: "",
  condition: "any",
  bodyType: "any",
  priceMinEUR: null,
  priceMaxEUR: null,
  includeUnavailable: false
};

function buildQueryString(filters: AdminVehicleFilters, page: number, pageSize: number) {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.make?.trim()) params.set("make", filters.make.trim());
  if (filters.location?.trim()) params.set("location", filters.location.trim());
  if (filters.condition && filters.condition !== "any") params.set("condition", filters.condition);
  if (filters.bodyType && filters.bodyType !== "any") params.set("bodyType", filters.bodyType);
  if (typeof filters.priceMinEUR === "number") params.set("priceMinEUR", String(filters.priceMinEUR));
  if (typeof filters.priceMaxEUR === "number") params.set("priceMaxEUR", String(filters.priceMaxEUR));
  if (filters.includeUnavailable) params.set("includeUnavailable", "true");
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

export default function AdminVehiclesPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<AdminVehicleFilters>(DEFAULT_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [vehicles, setVehicles] = useState<AdminVehicleListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(filters.q ?? ""), 300);
    return () => window.clearTimeout(timeout);
  }, [filters.q]);

  const queryFilters = useMemo(
    () => ({ ...filters, q: debouncedSearch }),
    [filters, debouncedSearch]
  );

  const queryString = useMemo(
    () => buildQueryString(queryFilters, page, pageSize),
    [queryFilters, page, pageSize]
  );

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    filters.make,
    filters.location,
    filters.condition,
    filters.bodyType,
    filters.priceMinEUR,
    filters.priceMaxEUR,
    filters.includeUnavailable
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadVehicles() {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/vehicles?${queryString}`);
        const payload = (await response.json()) as AdminVehicleListResult;
        if (!cancelled) {
          setVehicles(payload.vehicles ?? []);
          setTotal(payload.total ?? 0);
          setTotalPages(payload.totalPages ?? 0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadVehicles();
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  async function handleDeactivate(id: string) {
    const response = await fetch(adminVehicleApiPath(id), { method: "DELETE" });
    if (!response.ok) throw new Error("Failed to deactivate");
    setVehicles((current) =>
      current.map((vehicle) => (vehicle.id === id ? { ...vehicle, available: false } : vehicle))
    );
    router.refresh();
  }

  async function handleActivate(id: string) {
    const response = await fetch(adminVehicleApiPath(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: true })
    });
    if (!response.ok) throw new Error("Failed to activate");
    setVehicles((current) =>
      current.map((vehicle) => (vehicle.id === id ? { ...vehicle, available: true } : vehicle))
    );
    router.refresh();
  }

  function handleResetFilters() {
    setFilters(DEFAULT_FILTERS);
    setDebouncedSearch("");
    setPage(1);
  }

  return (
    <AdminShell>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-extrabold">Vehicles</h1>
          <p className="text-muted-foreground">Search, filter, and manage inventory.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href="/admin/vehicles/import" />}>
            Import CSV
          </Button>
          <Button nativeButton={false} render={<Link href="/admin/vehicles/new" />}>
            Add vehicle
          </Button>
        </div>
      </div>

      <AdminVehiclesFilters
        filters={filters}
        onChange={setFilters}
        onReset={handleResetFilters}
      />

      {!loading ? (
        <AdminVehiclesPagination
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      ) : null}

      {loading ? (
        <AdminTableSkeleton rows={10} columns={5} />
      ) : (
        <VehiclesTable
          vehicles={vehicles}
          onDeactivate={handleDeactivate}
          onActivate={handleActivate}
        />
      )}

      {!loading && total > 0 ? (
        <AdminVehiclesPagination
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={totalPages}
          loading={loading}
          onPageChange={setPage}
        />
      ) : null}
    </AdminShell>
  );
}

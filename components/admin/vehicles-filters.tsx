"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  VEHICLE_WIZARD_BODY_TYPES,
  VEHICLE_WIZARD_CONDITIONS
} from "@/lib/admin-vehicle-helpers";
import type { AdminVehicleListQuery } from "@/lib/repositories/admin-vehicle-repository";

export type AdminVehicleFilters = Omit<AdminVehicleListQuery, "page" | "pageSize">;

type AdminVehiclesFiltersProps = {
  filters: AdminVehicleFilters;
  onChange: (filters: AdminVehicleFilters) => void;
  onReset: () => void;
};

export function AdminVehiclesFilters({ filters, onChange, onReset }: AdminVehiclesFiltersProps) {
  function update(patch: Partial<AdminVehicleFilters>) {
    onChange({ ...filters, ...patch });
  }

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="flex flex-col gap-2 md:col-span-2 xl:col-span-3">
          <Label htmlFor="vehicle-search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="vehicle-search"
              className="pl-9"
              placeholder="Make, model, title, ID, or location"
              value={filters.q ?? ""}
              onChange={(event) => update({ q: event.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="vehicle-make">Make</Label>
          <Input
            id="vehicle-make"
            placeholder="e.g. Volkswagen"
            value={filters.make ?? ""}
            onChange={(event) => update({ make: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="vehicle-location">Location</Label>
          <Input
            id="vehicle-location"
            placeholder="e.g. Wien"
            value={filters.location ?? ""}
            onChange={(event) => update({ location: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Condition</Label>
          <Select
            value={filters.condition ?? "any"}
            onValueChange={(value) =>
              update({ condition: value as AdminVehicleFilters["condition"] })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any condition</SelectItem>
              {VEHICLE_WIZARD_CONDITIONS.map((condition) => (
                <SelectItem key={condition} value={condition}>
                  {condition}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Body type</Label>
          <Select
            value={filters.bodyType ?? "any"}
            onValueChange={(value) =>
              update({ bodyType: value as AdminVehicleFilters["bodyType"] })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any body type</SelectItem>
              {VEHICLE_WIZARD_BODY_TYPES.map((bodyType) => (
                <SelectItem key={bodyType} value={bodyType}>
                  {bodyType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="vehicle-price-min">Min price (EUR)</Label>
          <Input
            id="vehicle-price-min"
            type="number"
            min={0}
            placeholder="0"
            value={filters.priceMinEUR ?? ""}
            onChange={(event) =>
              update({
                priceMinEUR: event.target.value ? Number(event.target.value) : null
              })
            }
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="vehicle-price-max">Max price (EUR)</Label>
          <Input
            id="vehicle-price-max"
            type="number"
            min={0}
            placeholder="100000"
            value={filters.priceMaxEUR ?? ""}
            onChange={(event) =>
              update({
                priceMaxEUR: event.target.value ? Number(event.target.value) : null
              })
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={filters.includeUnavailable ? "default" : "outline"}
          onClick={() => update({ includeUnavailable: !filters.includeUnavailable })}
        >
          {filters.includeUnavailable ? "Including unavailable" : "Available only"}
        </Button>
        <Button type="button" variant="ghost" onClick={onReset}>
          Reset filters
        </Button>
      </div>
    </div>
  );
}

"use client";

import { VehicleImage } from "@/components/vehicle-image";
import Link from "next/link";
import { useState } from "react";
import { SaveCarButton } from "@/components/save-car-button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { Vehicle } from "@/lib/types";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";
import {
  getVehicleDetailSections,
  getVehicleDetailStats,
  vehicleDetailSectionId,
} from "@/lib/vehicle-detail-fields";

export type SavedCarCard = {
  id: string;
  href: string;
  snapshot: SavedCarSnapshot;
  vehicle: Vehicle | null;
};

export function SavedCarGrid({ cars }: { cars: SavedCarCard[] }) {
  const [visibleCars, setVisibleCars] = useState(cars);
  const [selectedCar, setSelectedCar] = useState<SavedCarCard | null>(null);

  if (!visibleCars.length) {
    return (
      <div className="rounded-3xl bg-muted px-6 py-16 text-center">
        <h2 className="font-display font-bold text-xl">No saved cars yet</h2>
        <p className="text-muted-foreground mt-2">
          Bookmark a match and it will appear here for comparison.
        </p>
        <Link
          href="/chat"
          className="inline-flex mt-6 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Find matches
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {visibleCars.map((car) => (
          <article
            key={car.id}
            className="rounded-3xl bg-muted overflow-hidden flex flex-col hover:shadow-[0_20px_50px_-20px_rgba(40,40,80,0.25)] transition-shadow"
          >
            <div className="relative">
              <button
                type="button"
                aria-label={`Open ${car.snapshot.name} details`}
                onClick={() => setSelectedCar(car)}
                className="block w-full"
              >
                <SavedCarImage snapshot={car.snapshot} />
              </button>
              {typeof car.snapshot.match === "number" ? (
                <span className="absolute top-3 left-3 bg-match text-match-foreground text-xs font-semibold px-3 py-1.5 rounded-full">
                  {car.snapshot.match}% match
                </span>
              ) : null}
              <SaveCarButton
                vehicleId={car.id}
                snapshot={car.snapshot}
                initialSaved
                className="absolute top-3 right-3 size-9 rounded-full bg-white flex items-center justify-center shadow text-foreground"
                activeClassName="text-primary"
                label={`Unsave ${car.snapshot.name}`}
                onUnsave={(vehicleId) => {
                  setVisibleCars((current) =>
                    current.filter((item) => item.id !== vehicleId),
                  );
                  if (selectedCar?.id === vehicleId) setSelectedCar(null);
                }}
              />
            </div>
            <button
              type="button"
              className="p-5 text-left"
              onClick={() => setSelectedCar(car)}
            >
              <h3 className="font-display font-bold text-lg">
                {car.snapshot.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {car.snapshot.location ?? "Location pending"}
              </p>
              <div className="mt-3 flex items-end justify-between">
                <div className="font-display font-bold">
                  {car.snapshot.price}
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent text-accent-foreground">
                  {car.snapshot.condition}
                </span>
              </div>
            </button>
          </article>
        ))}
      </div>
      <SavedCarSheet car={selectedCar} onClose={() => setSelectedCar(null)} />
    </>
  );
}

function SavedCarSheet({
  car,
  onClose,
}: {
  car: SavedCarCard | null;
  onClose: () => void;
}) {
  if (!car) return null;

  const { snapshot, vehicle } = car;
  const stats = vehicle
    ? getVehicleDetailStats(vehicle)
    : getSavedCarStats(car);
  const detailSections = vehicle
    ? getVehicleDetailSections(vehicle)
    : [{ heading: "Specs", items: getSavedCarSpecs(car) }];

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[calc(100vw-40px)] sm:max-w-lg overflow-y-auto p-0 border-0 shadow-2xl"
        style={{
          top: 20,
          bottom: 20,
          right: 20,
          height: "auto",
          borderRadius: 20,
        }}
      >
        <div className="sticky top-0 z-10 p-5 border-b border-border bg-background rounded-t-[20px]">
          <div className="flex items-center gap-3">
            <div className="relative size-16 shrink-0 rounded-2xl overflow-hidden">
              <SavedCarImage snapshot={snapshot} />
              {typeof snapshot.match === "number" ? (
                <span className="absolute top-1 left-1 bg-match text-match-foreground text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                  {snapshot.match}%
                </span>
              ) : null}
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-lg truncate">
                {snapshot.name}
              </h3>
              <div className="font-display font-bold text-sm mt-0.5">
                {vehicle ? formatEUR(vehicle.priceEUR) : snapshot.price}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            <Chip highlight>{snapshot.condition}</Chip>
            {(vehicle?.year ?? snapshot.year) ? (
              <Chip>{vehicle?.year ?? snapshot.year}</Chip>
            ) : null}
            <Chip>EV</Chip>
            {vehicle?.rangeKm ? (
              <Chip>Range: {formatNumber(vehicle.rangeKm)} km</Chip>
            ) : null}
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {stats.map(({ label, value }) => (
              <StatTile label={label} value={value} key={label} />
            ))}
          </div>

          {detailSections.map((section) => {
            const headingId = vehicleDetailSectionId("saved", section.heading);
            return (
              <section key={section.heading} aria-labelledby={headingId}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {section.heading}
                </div>
                <dl className="rounded-2xl bg-muted/50 p-3 text-sm divide-y divide-border">
                  {section.items.map(({ label, value }) => (
                    <SpecRow k={label} v={value} key={label} />
                  ))}
                </dl>
              </section>
            );
          })}

          {car.href.startsWith("http") ? (
            <Link
              className="inline-flex w-full items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
              href={car.href}
              target="_blank"
              rel="noreferrer"
            >
              Open offer
            </Link>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Chip({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <span
      className={`text-xs px-2.5 py-1 rounded-lg ${
        highlight
          ? "bg-accent text-accent-foreground font-semibold"
          : "bg-muted text-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/50 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display font-bold text-[15px] mt-0.5">{value}</div>
    </div>
  );
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 py-1.5 first:pt-0 last:pb-0">
      <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="flex-1 text-foreground break-all">{v}</dd>
    </div>
  );
}

function getSavedCarStats(car: SavedCarCard) {
  const { snapshot, vehicle } = car;
  return [
    {
      label: "Price",
      value: vehicle ? formatEUR(vehicle.priceEUR) : snapshot.price,
    },
    {
      label: "Range",
      value: vehicle
        ? `${formatNumber(vehicle.rangeKm)} km`
        : (snapshot.range ?? "Not provided"),
    },
    {
      label: "Mileage",
      value:
        vehicle?.mileageKm === null
          ? "Not provided"
          : vehicle?.mileageKm
            ? `${formatNumber(vehicle.mileageKm)} km`
            : (snapshot.mileage ?? "Not provided"),
    },
    {
      label: "Location",
      value: vehicle?.location ?? snapshot.location ?? "Not provided",
    },
    {
      label: "Battery",
      value: vehicle ? `${vehicle.batteryKwh} kWh` : "Not provided",
    },
    {
      label: "SoH",
      value:
        vehicle?.batterySoH === null || !vehicle
          ? "Not provided"
          : `${vehicle.batterySoH}%`,
    },
  ];
}

function getSavedCarSpecs(car: SavedCarCard) {
  const { snapshot, vehicle } = car;
  return [
    { label: "Make", value: vehicle?.make ?? snapshot.make ?? "Not provided" },
    {
      label: "Model",
      value: vehicle?.model ?? snapshot.model ?? "Not provided",
    },
    { label: "Condition", value: snapshot.condition },
    {
      label: "Body",
      value: vehicle?.bodyType?.replace(/_/g, " ") ?? "Not provided",
    },
    { label: "Seats", value: vehicle ? String(vehicle.seats) : "Not provided" },
    { label: "Drivetrain", value: vehicle?.drivetrain ?? "Not provided" },
  ];
}

function SavedCarImage({ snapshot }: { snapshot: SavedCarSnapshot }) {
  return (
    <VehicleImage
      images={snapshot.image ? [snapshot.image] : []}
      alt={snapshot.name}
      width={720}
      height={520}
      className="w-full h-52 object-cover"
    />
  );
}

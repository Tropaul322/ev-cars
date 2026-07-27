import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import { VehicleImage } from "@/components/vehicle-image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WebShell } from "@/components/WebShell";
import { ProtectedCarActions } from "@/components/protected-car-actions";
import { demoCars, demoQuickStats, demoScoreBreakdown, type DemoCar } from "@/lib/flowryd-demo-data";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";
import { getVehicleById, listVehicles } from "@/lib/repositories/vehicle-repository";
import type { Vehicle } from "@/lib/types";
import { formatEUR, formatNumber } from "@/lib/utils";
import {
  formatBodyType,
  formatCondition,
  getVehicleDetailSections,
  getVehicleDetailStats,
} from "@/lib/vehicle-detail-fields";

export const revalidate = 60;

export async function generateStaticParams() {
  const demoIds = Object.keys(demoCars).map((id) => ({ id }));

  try {
    const vehicles = await listVehicles();
    const seen = new Set(demoIds.map((item) => item.id));
    const inventoryIds = vehicles
      .slice(0, 200)
      .map((vehicle) => vehicle.id)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((id) => ({ id }));

    return [...demoIds, ...inventoryIds];
  } catch {
    return demoIds;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vehicle = await getVehicleById(id);
  if (vehicle) {
    const name = vehicleDisplayName(vehicle);
    return {
      title: `${name} — FlowRyd`,
      description: `${name} — ${formatNumber(vehicle.rangeKm)} km range, ${formatEUR(vehicle.priceEUR)}.`,
    };
  }

  const car = demoCars[id];
  return {
    title: car ? `${car.name} — FlowRyd` : "Car — FlowRyd",
    description: car ? `${car.name} — ${car.range} range, ${car.price}.` : undefined,
  };
}

export default async function CarDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vehicle = await getVehicleById(id);
  if (vehicle) {
    const snapshot = snapshotFromVehicle(vehicle);
    return (
      <RealVehicleDetail vehicle={vehicle} snapshot={snapshot} />
    );
  }

  const car = demoCars[id];
  if (!car) notFound();
  const stats = demoQuickStats[car.id];
  const scores = demoScoreBreakdown[car.id] ?? [];
  const snapshot = snapshotFromDemoCar(car);

  return (
    <WebShell>
      <div className="mx-auto max-w-7xl w-full px-6 lg:px-10 py-8">
        <Link
          href="/chat"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to chat
        </Link>

        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-8">
          <div>
            <div className="relative rounded-3xl overflow-hidden bg-muted">
              <Image
                src={car.image}
                alt={car.name}
                width={980}
                height={735}
                priority
                className="w-full aspect-[4/3] object-cover"
              />
              <div className="absolute bottom-4 inset-x-0 flex justify-center gap-1.5" aria-hidden="true">
                <span className="h-1.5 w-8 rounded-full bg-white" />
                <span className="h-1.5 w-2 rounded-full bg-white/50" />
                <span className="h-1.5 w-2 rounded-full bg-white/50" />
                <span className="h-1.5 w-2 rounded-full bg-white/50" />
              </div>
            </div>

            <section className="mt-8 space-y-4">
              <h2 className="font-display font-extrabold text-xl">Details</h2>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Price" value={car.price} />
                <StatTile label="Range" value={car.range} />
                <StatTile label="Cargo" value={stats.cargo} />
                <StatTile label="Efficiency" value={stats.efficiency} />
                <StatTile label="Battery" value={stats.battery} />
                <StatTile label="SoH" value={car.condition === "New" ? "new" : stats.soh} />
              </div>
            </section>

            <section className="mt-10">
              <h2 className="font-display font-extrabold text-xl mb-4">Score breakdown</h2>
              <div className="rounded-2xl bg-muted/50 p-3 grid grid-cols-1 gap-1.5">
                {scores.map(([label, value]) => (
                  <ScoreRow key={label} label={label} value={value} />
                ))}
              </div>
            </section>

            <section className="mt-10">
              <h2 className="font-display font-extrabold text-xl mb-4">Reviews</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <ReviewCard
                  name="Jose"
                  when="10h"
                  location="San Francisco, CA"
                  text="After 6 months daily — super smooth drive, great efficiency, software keeps improving."
                />
                <ReviewCard
                  name="Mia"
                  when="2d"
                  location="Los Angeles, CA"
                  text="Range matches the advertised spec on the highway. Charging network is unbeatable for road trips."
                />
              </div>
            </section>
          </div>

          <aside>
            <div className="lg:sticky lg:top-24 space-y-4">
              <div className="rounded-3xl bg-muted p-6">
                <span className="inline-block bg-match text-match-foreground text-xs font-semibold px-3 py-1.5 rounded-full">
                  {car.match}% match
                </span>
                <h1 className="font-display font-extrabold text-3xl mt-3">{car.name}</h1>
                <p className="text-muted-foreground">{car.location}</p>

                <div className="mt-5 flex items-end justify-between">
                  <div className="font-display font-extrabold text-3xl">{car.price}</div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent text-accent-foreground">
                    {car.condition}
                  </span>
                </div>

                <ProtectedCarActions hydrateSavedState snapshot={snapshot} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat label="Year" value={String(car.year)} />
                <Stat label="Fuel" value={car.fuel} />
                <Stat label="Range" value={car.range} />
                <Stat label="Mileage" value={car.mileage ?? "—"} />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </WebShell>
  );
}

function RealVehicleDetail({
  vehicle,
  snapshot,
}: {
  vehicle: Vehicle;
  snapshot: SavedCarSnapshot;
}) {
  const name = vehicleDisplayName(vehicle);
  const stats = getVehicleDetailStats(vehicle);
  const sections = getVehicleDetailSections(vehicle);

  return (
    <WebShell>
      <div className="mx-auto max-w-7xl w-full px-6 lg:px-10 py-8">
        <Link
          href="/chat"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to chat
        </Link>

        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-8">
          <div>
            <div className="relative rounded-3xl overflow-hidden bg-muted">
              <VehicleImage
                images={vehicle.images}
                alt={name}
                width={980}
                height={735}
                priority
                className="w-full aspect-[4/3] object-cover"
              />
            </div>

            <section className="mt-8 space-y-4">
              <h2 className="font-display font-extrabold text-xl">Details</h2>
              <div className="grid grid-cols-2 gap-2">
                {stats.map((item) => (
                  <StatTile key={item.label} label={item.label} value={item.value} />
                ))}
              </div>
            </section>

            <section className="mt-10 space-y-5">
              <h2 className="font-display font-extrabold text-xl">Specifications</h2>
              {sections.map((section) => (
                <div key={section.heading}>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.heading}
                  </h3>
                  <dl className="rounded-2xl bg-muted/50 p-3 text-sm divide-y divide-border">
                    {section.items.map((item) => (
                      <SpecRow key={item.label} k={item.label} v={item.value} />
                    ))}
                  </dl>
                </div>
              ))}
            </section>
          </div>

          <aside>
            <div className="lg:sticky lg:top-24 space-y-4">
              <div className="rounded-3xl bg-muted p-6">
                <span className="inline-block bg-match text-match-foreground text-xs font-semibold px-3 py-1.5 rounded-full">
                  {vehicle.available ? "Available" : "Unavailable"}
                </span>
                <h1 className="font-display font-extrabold text-3xl mt-3">{name}</h1>
                <p className="text-muted-foreground">{vehicle.location ?? "Austria"}</p>

                <div className="mt-5 flex items-end justify-between gap-4">
                  <div className="font-display font-extrabold text-3xl">{formatEUR(vehicle.priceEUR)}</div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent text-accent-foreground">
                    {formatCondition(vehicle.condition)}
                  </span>
                </div>

                <ProtectedCarActions hydrateSavedState snapshot={snapshot} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat label="Year" value={String(vehicle.year)} />
                <Stat label="Body" value={formatBodyType(vehicle.bodyType)} />
                <Stat label="Range" value={`${formatNumber(vehicle.rangeKm)} km`} />
                <Stat
                  label="Mileage"
                  value={vehicle.mileageKm === null ? "Not provided" : `${formatNumber(vehicle.mileageKm)} km`}
                />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </WebShell>
  );
}

function snapshotFromVehicle(vehicle: Vehicle): SavedCarSnapshot {
  return {
    id: vehicle.id,
    name: vehicleDisplayName(vehicle),
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    price: formatEUR(vehicle.priceEUR),
    condition: formatCondition(vehicle.condition),
    location: vehicle.location,
    image: vehicle.images[0] ?? null,
    match: null,
    range: `${formatNumber(vehicle.rangeKm)} km`,
    mileage: vehicle.mileageKm === null ? null : `${formatNumber(vehicle.mileageKm)} km`,
    listingUrl: vehicle.listingUrl ?? null,
  };
}

function vehicleDisplayName(vehicle: Vehicle) {
  return [vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ");
}

function snapshotFromDemoCar(car: DemoCar): SavedCarSnapshot {
  return {
    id: car.id,
    name: car.name,
    make: car.brand,
    model: car.name.replace(car.brand, "").trim() || car.name,
    year: car.year,
    price: car.price,
    condition: car.condition,
    location: car.location,
    image: car.image,
    match: car.match,
    range: car.range,
    mileage: car.mileage ?? null,
  };
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/50 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display font-bold text-[15px] mt-0.5">{value}</div>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  const tone = value >= 75 ? "text-foreground" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="flex-1 text-muted-foreground">{label}</span>
      <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${value}%` }} />
      </div>
      <span className={`w-10 text-right font-semibold tabular-nums ${tone}`}>{value}%</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted rounded-2xl p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-display font-bold text-lg mt-1">{value}</div>
    </div>
  );
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[42%_1fr] gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium text-right">{v}</dd>
    </div>
  );
}

function ReviewCard({
  name,
  when,
  location,
  text,
}: {
  name: string;
  when: string;
  location: string;
  text: string;
}) {
  return (
    <article className="rounded-2xl border border-border p-4">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-bold">
          {name[0]}
        </div>
        <div>
          <div className="font-semibold">
            {name} <span className="text-muted-foreground font-normal">{when}</span>
          </div>
          <div className="text-xs bg-muted rounded-md px-2 py-0.5 inline-block mt-0.5">{location}</div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed">{text}</p>
    </article>
  );
}

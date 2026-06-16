"use client";

import { X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { SaveCarButton } from "@/components/save-car-button";
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useAnimatedDrawer } from "@/components/ui/use-animated-drawer";
import type { Vehicle } from "@/lib/types";
import { formatEUR, formatNumber } from "@/lib/utils";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";
import {
  getVehicleDetailSections,
  getVehicleDetailStats,
  vehicleDetailSectionId
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
      <div className="flow-empty-state">
        <h2>No saved cars yet</h2>
        <p>Bookmark a match and it will appear here for comparison.</p>
        <Link href="/chat">Find matches</Link>
      </div>
    );
  }

  return (
    <>
      <div className="flow-card-grid flow-card-grid-three">
        {visibleCars.map((car) => (
          <article className="flow-car-card" key={car.id}>
            <div className="flow-car-media">
              <button
                className="flow-card-media-button"
                type="button"
                aria-label={`Open ${car.snapshot.name} details`}
                onClick={() => setSelectedCar(car)}
              >
                <SavedCarImage snapshot={car.snapshot} />
              </button>
              {typeof car.snapshot.match === "number" ? (
                <span className="trending-match">{car.snapshot.match}% match</span>
              ) : null}
              <SaveCarButton
                vehicleId={car.id}
                snapshot={car.snapshot}
                initialSaved
                className="trending-save"
                activeClassName="trending-save-active"
                label={`Unsave ${car.snapshot.name}`}
                onUnsave={(vehicleId) => {
                  setVisibleCars((current) => current.filter((item) => item.id !== vehicleId));
                  if (selectedCar?.id === vehicleId) setSelectedCar(null);
                }}
              />
            </div>
            <button className="trending-body flow-car-card-body-button" type="button" onClick={() => setSelectedCar(car)}>
              <h3>{car.snapshot.name}</h3>
              <p>{car.snapshot.location ?? "Location pending"}</p>
              <div className="trending-meta">
                <span>{car.snapshot.price}</span>
                <span>{car.snapshot.condition}</span>
              </div>
            </button>
          </article>
        ))}
      </div>
      <SavedCarDrawer car={selectedCar} onClose={() => setSelectedCar(null)} />
    </>
  );
}

function SavedCarDrawer({ car, onClose }: { car: SavedCarCard | null; onClose: () => void }) {
  const { open, onOpenChange } = useAnimatedDrawer(Boolean(car), onClose);

  if (!car) return null;

  const { snapshot, vehicle } = car;
  const stats = vehicle ? getVehicleDetailStats(vehicle) : getSavedCarStats(car);
  const detailSections = vehicle
    ? getVehicleDetailSections(vehicle)
    : [
        {
          heading: "Specs",
          items: getSavedCarSpecs(car)
        }
      ];

  return (
    <Drawer
      open={open}
      direction="right"
      shouldScaleBackground={false}
      onOpenChange={onOpenChange}
    >
      <DrawerContent className="flow-detail-panel">
        <DrawerClose className="flow-detail-close" aria-label="Close details">
          <X size={18} aria-hidden="true" />
        </DrawerClose>

        <div className="flow-detail-panel-body">
          <DrawerHeader className="flow-detail-drawer-header">
            <div className="flow-detail-drawer-thumb">
              <SavedCarImage snapshot={snapshot} />
              {typeof snapshot.match === "number" ? <span>{snapshot.match}%</span> : null}
            </div>
            <div>
              <DrawerTitle className="flow-detail-drawer-title">{snapshot.name}</DrawerTitle>
              <p className="flow-detail-drawer-price">
                {vehicle ? formatEUR(vehicle.priceEUR) : snapshot.price}
              </p>
            </div>
          </DrawerHeader>

          <div className="flow-chip-row flow-drawer-chip-row" aria-label={`${snapshot.name} attributes`}>
            <span>{snapshot.condition}</span>
            {vehicle?.year ?? snapshot.year ? <span>{vehicle?.year ?? snapshot.year}</span> : null}
            <span>EV</span>
            {vehicle?.rangeKm ? <span>Range: {formatNumber(vehicle.rangeKm)} km</span> : null}
          </div>

          <section className="flow-drawer-stat-grid" aria-label="Vehicle quick stats">
            {stats.map(({ label, value }) => (
              <DrawerStat label={label} value={value} key={label} />
            ))}
          </section>

          {detailSections.map((section) => {
            const headingId = vehicleDetailSectionId("saved", section.heading);
            return (
              <section className="flow-drawer-section" aria-labelledby={headingId} key={section.heading}>
                <h3 id={headingId}>{section.heading}</h3>
                <dl className="flow-drawer-specs">
                  {section.items.map(({ label, value }) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}

          {car.href.startsWith("http") ? (
            <Link className="flow-drawer-primary-link" href={car.href} target="_blank" rel="noreferrer">
              Open listing
            </Link>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function DrawerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flow-drawer-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getSavedCarStats(car: SavedCarCard) {
  const { snapshot, vehicle } = car;
  return [
    { label: "Price", value: vehicle ? formatEUR(vehicle.priceEUR) : snapshot.price },
    { label: "Range", value: vehicle ? `${formatNumber(vehicle.rangeKm)} km` : snapshot.range ?? "Not provided" },
    { label: "Mileage", value: vehicle?.mileageKm === null ? "Not provided" : vehicle?.mileageKm ? `${formatNumber(vehicle.mileageKm)} km` : snapshot.mileage ?? "Not provided" },
    { label: "Location", value: vehicle?.location ?? snapshot.location ?? "Not provided" },
    { label: "Battery", value: vehicle ? `${vehicle.batteryKwh} kWh` : "Not provided" },
    { label: "SoH", value: vehicle?.batterySoH === null || !vehicle ? "Not provided" : `${vehicle.batterySoH}%` }
  ];
}

function getSavedCarSpecs(car: SavedCarCard) {
  const { snapshot, vehicle } = car;
  return [
    { label: "Make", value: vehicle?.make ?? snapshot.make ?? "Not provided" },
    { label: "Model", value: vehicle?.model ?? snapshot.model ?? "Not provided" },
    { label: "Condition", value: snapshot.condition },
    { label: "Body", value: vehicle?.bodyType?.replace(/_/g, " ") ?? "Not provided" },
    { label: "Seats", value: vehicle ? String(vehicle.seats) : "Not provided" },
    { label: "Drivetrain", value: vehicle?.drivetrain ?? "Not provided" }
  ];
}

function SavedCarImage({ snapshot }: { snapshot: SavedCarSnapshot }) {
  if (!snapshot.image) {
    return <div className="flow-car-image-placeholder">{snapshot.name}</div>;
  }

  const isRemoteImage = snapshot.image.startsWith("http://") || snapshot.image.startsWith("https://");
  return <Image src={snapshot.image} alt={snapshot.name} width={720} height={520} unoptimized={isRemoteImage} />;
}

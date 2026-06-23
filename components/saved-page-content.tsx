"use client";

import { useEffect, useState } from "react";
import { DemoAccessRequired } from "@/components/demo-access-required";
import {
  SavedCarGrid,
  type SavedCarCard,
} from "@/components/saved-car-grid";
import {
  getCachedSavedCars,
  setCachedSavedCars,
  shouldRevalidateSavedCars,
} from "@/lib/client-data-cache";
import type { SavedCar } from "@/lib/repositories/saved-car-repository";
import {
  snapshotFromVehicle,
  type SavedCarSnapshot,
} from "@/lib/repositories/saved-car-repository";

export function SavedPageContent({
  initialCars = [],
}: {
  initialCars?: SavedCarCard[];
}) {
  const [cars, setCars] = useState<SavedCarCard[]>(() => {
    const cached = getCachedSavedCars();
    return cached ?? (initialCars.length ? initialCars : []);
  });
  const [loading, setLoading] = useState(() => !getCachedSavedCars());

  useEffect(() => {
    const cached = getCachedSavedCars();
    if (cached) setCars(cached);

    if (cached && !shouldRevalidateSavedCars()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      if (!cached) setLoading(true);
      try {
        const response = await fetch("/api/saved-cars");
        if (response.status === 401) {
          if (!cancelled) setCars([]);
          return;
        }
        if (!response.ok) return;
        const data = (await response.json()) as { savedCars?: SavedCar[] };
        if (cancelled) return;
        const next = (data.savedCars ?? []).map(savedCarToCard);
        setCachedSavedCars(next);
        setCars(next);
      } catch {
        // Keep cached content when refresh fails.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    function onSavedCarsChanged() {
      void (async () => {
        try {
          const response = await fetch("/api/saved-cars");
          if (!response.ok) return;
          const data = (await response.json()) as { savedCars?: SavedCar[] };
          const next = (data.savedCars ?? []).map(savedCarToCard);
          setCachedSavedCars(next);
          setCars(next);
        } catch {
          // Ignore background refresh failures.
        }
      })();
    }

    window.addEventListener("flowryd:saved-cars-changed", onSavedCarsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(
        "flowryd:saved-cars-changed",
        onSavedCarsChanged,
      );
    };
  }, [initialCars]);

  return (
    <>
      <DemoAccessRequired />
      <div className="mx-auto max-w-7xl w-full px-6 lg:px-10 py-10">
        <header className="mb-8">
          <h1 className="font-display font-extrabold text-3xl">Saved cars</h1>
          <p className="text-muted-foreground mt-1">
            Your shortlisted matches, ready to compare.
          </p>
        </header>

        {loading && !cars.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-72 rounded-3xl bg-muted/60 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <SavedCarGrid cars={cars} />
        )}
      </div>
    </>
  );
}

function savedCarToCard(savedCar: SavedCar): SavedCarCard {
  const snapshot = snapshotForSavedCar(savedCar);
  return {
    id: savedCar.vehicleId,
    href: savedCar.vehicle?.listingUrl ?? `/car/${savedCar.vehicleId}`,
    snapshot,
    vehicle: savedCar.vehicle,
  };
}

function snapshotForSavedCar(savedCar: SavedCar): SavedCarSnapshot {
  if (savedCar.vehicle) {
    return {
      ...snapshotFromVehicle(savedCar.vehicle, savedCar.snapshot?.match),
      ...savedCar.snapshot,
      id: savedCar.vehicleId,
    };
  }

  return (
    savedCar.snapshot ?? {
      id: savedCar.vehicleId,
      name: savedCar.vehicleId,
      price: "Price on request",
      condition: "EV",
    }
  );
}

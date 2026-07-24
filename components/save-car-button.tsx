"use client";

import { Bookmark } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { invalidateSavedCarsCache } from "@/lib/client-data-cache";
import { requireDemoAccess } from "@/lib/demo-access-client";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";

export function SaveCarButton({
  vehicleId,
  snapshot,
  initialSaved = false,
  hydrateSavedState = false,
  className,
  activeClassName,
  label,
  onUnsave
}: {
  vehicleId: string;
  snapshot: SavedCarSnapshot;
  initialSaved?: boolean;
  hydrateSavedState?: boolean;
  className: string;
  activeClassName?: string;
  label?: string;
  onUnsave?: (vehicleId: string) => void;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hydrateSavedState) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/saved-cars");
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as {
          savedCars?: Array<{ vehicleId: string }>;
        };
        const isSaved = data.savedCars?.some((item) => item.vehicleId === vehicleId) ?? false;
        if (!cancelled && isSaved) setSaved(true);
      } catch {
        // Keep the default saved state when hydration fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateSavedState, vehicleId]);

  async function toggleSaved(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (busy) return;
    if (!(await requireDemoAccess())) return;

    setBusy(true);
    const nextSaved = !saved;
    setSaved(nextSaved);

    try {
      const response = await fetch(nextSaved ? "/api/saved-cars" : `/api/saved-cars/${encodeURIComponent(vehicleId)}`, {
        method: nextSaved ? "POST" : "DELETE",
        headers: nextSaved ? { "Content-Type": "application/json" } : undefined,
        body: nextSaved ? JSON.stringify({ vehicleId, snapshot }) : undefined
      });

      if (!response.ok) {
        setSaved(saved);
        return;
      }

      if (!nextSaved) onUnsave?.(vehicleId);
      invalidateSavedCarsCache();
      window.dispatchEvent(new Event("flowryd:saved-cars-changed"));
    } catch {
      setSaved(saved);
    } finally {
      setBusy(false);
    }
  }

  const isActive = saved && activeClassName;

  return (
    <button
      className={isActive ? `${className} ${activeClassName}` : className}
      type="button"
      aria-label={label ?? (saved ? `Unsave ${snapshot.name}` : `Save ${snapshot.name}`)}
      aria-pressed={saved}
      disabled={busy}
      onClick={toggleSaved}
    >
      <Bookmark size={18} aria-hidden="true" fill={saved ? "currentColor" : "none"} />
    </button>
  );
}

"use client";

import { Bookmark } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import { requireDemoAccess } from "@/lib/demo-access-client";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";

export function SaveCarButton({
  vehicleId,
  snapshot,
  initialSaved = false,
  className,
  activeClassName,
  label,
  onUnsave
}: {
  vehicleId: string;
  snapshot: SavedCarSnapshot;
  initialSaved?: boolean;
  className: string;
  activeClassName?: string;
  label?: string;
  onUnsave?: (vehicleId: string) => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);

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
      router.refresh();
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

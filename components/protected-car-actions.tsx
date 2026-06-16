"use client";

import { requireDemoAccess } from "@/lib/demo-access-client";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";
import { SaveCarButton } from "./save-car-button";

export function ProtectedCarActions({
  initialSaved = false,
  snapshot
}: {
  initialSaved?: boolean;
  snapshot: SavedCarSnapshot;
}) {
  return (
    <>
      <div className="flow-buy-actions">
        <button type="button" onClick={() => void requireDemoAccess()}>
          Buy now
        </button>
        <SaveCarButton
          vehicleId={snapshot.id}
          snapshot={snapshot}
          initialSaved={initialSaved}
          className="flow-save-action"
          activeClassName="flow-save-action-active"
        />
      </div>
      <button className="flow-secondary-action" type="button" onClick={() => void requireDemoAccess()}>
        Schedule test drive
      </button>
    </>
  );
}

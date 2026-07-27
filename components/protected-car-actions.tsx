"use client";

import { toast } from "sonner";
import { requireDemoAccess } from "@/lib/demo-access-client";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";
import { BuyNowButton } from "./buy-now-button";
import { SaveCarButton } from "./save-car-button";

export function ProtectedCarActions({
  initialSaved = false,
  hydrateSavedState = false,
  snapshot,
}: {
  initialSaved?: boolean;
  hydrateSavedState?: boolean;
  snapshot: SavedCarSnapshot;
}) {
  async function handleScheduleTestDrive() {
    const registered = await requireDemoAccess();
    if (!registered) return;
    toast.message("Test-drive scheduling is coming soon — we’ll notify you when it’s ready.");
  }

  return (
    <>
      <div className="mt-5 flex gap-3">
        <BuyNowButton
          vehicleId={snapshot.id}
          listingUrl={snapshot.listingUrl}
          className="flex-1 rounded-full bg-primary text-primary-foreground py-3 font-semibold hover:opacity-90"
        />
        <SaveCarButton
          vehicleId={snapshot.id}
          snapshot={snapshot}
          initialSaved={initialSaved}
          hydrateSavedState={hydrateSavedState}
          className="size-12 rounded-full bg-background flex items-center justify-center border border-border"
          activeClassName="text-primary"
        />
      </div>
      <button
        className="mt-3 w-full rounded-full bg-background py-3 font-semibold border border-border hover:bg-muted"
        type="button"
        onClick={() => void handleScheduleTestDrive()}
      >
        Schedule test drive
      </button>
    </>
  );
}

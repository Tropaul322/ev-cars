"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";
import { requireDemoAccess } from "@/lib/demo-access-client";
import { openBuyNowHref, resolveBuyNowAction } from "@/lib/buy-now";
import { cn } from "@/lib/utils";

type BuyNowButtonProps = {
  vehicleId: string;
  listingUrl?: string | null;
  className?: string;
  children?: ReactNode;
};

export function BuyNowButton({
  vehicleId,
  listingUrl,
  className,
  children = "Buy now",
}: BuyNowButtonProps) {
  async function handleClick() {
    const registered = await requireDemoAccess();
    const action = resolveBuyNowAction({
      registered,
      listingUrl,
      carPagePath: `/car/${vehicleId}`,
    });
    if (action.kind === "require_registration") return;
    toast.message("Opening purchase options…");
    openBuyNowHref(action.href);
  }

  return (
    <button type="button" className={cn(className)} onClick={() => void handleClick()}>
      {children}
    </button>
  );
}

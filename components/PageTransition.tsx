"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageTransition({
  children,
  fullHeight = false,
}: {
  children: ReactNode;
  fullHeight?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div
      key={pathname}
      className={cn(
        "flex flex-1 flex-col animate-in fade-in slide-in-from-bottom-4 duration-300 fill-mode-both motion-reduce:animate-none",
        fullHeight && "min-h-0",
      )}
    >
      {children}
    </div>
  );
}

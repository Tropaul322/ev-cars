"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function transitionKey(pathname: string) {
  if (pathname.startsWith("/chat")) return "/chat";
  if (pathname === "/saved") return "saved";
  return pathname;
}

export function PageTransition({
  children,
  fullHeight = false,
}: {
  children: ReactNode;
  fullHeight?: boolean;
}) {
  const pathname = usePathname();
  const animate = pathname !== "/" && !pathname.startsWith("/chat");

  return (
    <div
      key={transitionKey(pathname)}
      className={cn(
        "flex flex-1 flex-col",
        animate && "animate-in fade-in duration-200 fill-mode-both motion-reduce:animate-none",
        fullHeight && "min-h-0",
      )}
    >
      {children}
    </div>
  );
}

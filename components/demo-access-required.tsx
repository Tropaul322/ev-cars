"use client";

import { useEffect } from "react";
import { requireDemoAccess } from "@/lib/demo-access-client";

export function DemoAccessRequired() {
  useEffect(() => {
    void requireDemoAccess();
  }, []);

  return null;
}

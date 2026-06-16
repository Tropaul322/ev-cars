"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const DRAWER_CLOSE_DURATION_MS = 450;

function getDrawerCloseDuration() {
  if (typeof window === "undefined") return DRAWER_CLOSE_DURATION_MS;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : DRAWER_CLOSE_DURATION_MS;
}

export function useAnimatedDrawer(
  active: boolean,
  onClosed: () => void,
  duration = DRAWER_CLOSE_DURATION_MS
) {
  const [open, setOpen] = useState(active);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (active) {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      setOpen(true);
    }
  }, [active]);

  useEffect(
    () => () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    },
    []
  );

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        const closeDuration = duration === DRAWER_CLOSE_DURATION_MS ? getDrawerCloseDuration() : duration;
        if (closeDuration === 0) {
          onClosed();
          return;
        }

        closeTimeoutRef.current = setTimeout(() => {
          closeTimeoutRef.current = null;
          onClosed();
        }, closeDuration);
      }
    },
    [duration, onClosed]
  );

  return { open, onOpenChange };
}

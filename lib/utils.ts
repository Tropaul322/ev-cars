import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatEUR(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    ...options,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("de-AT", {
    maximumFractionDigits: 0,
  }).format(value);
}

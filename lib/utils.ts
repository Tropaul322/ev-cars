export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatEUR(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    ...options
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("de-AT", {
    maximumFractionDigits: 0
  }).format(value);
}

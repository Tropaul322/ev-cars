export type BuyNowAction =
  | { kind: "open_url"; href: string }
  | { kind: "require_registration" };

export function resolveBuyNowAction(input: {
  registered: boolean;
  listingUrl?: string | null;
  carPagePath: string;
}): BuyNowAction {
  if (!input.registered) return { kind: "require_registration" };
  const href = input.listingUrl?.trim() || input.carPagePath;
  return { kind: "open_url", href };
}

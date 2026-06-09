import type { Vehicle, VehicleImage } from "./types.ts";

const hovedSuffix = /_hoved(?=\.(?:jpe?g|png|webp)(?:\?|$))/i;
const thumbSuffix = /_thumb(?=\.(?:jpe?g|png|webp)(?:\?|$))/i;
const decorativeWillhaben = /cache\.willhaben\.at\/campaigns-v2\//i;

export function normalizeVehicleImageUrl(url: string) {
  return url.replace(hovedSuffix, "");
}

export function sanitizeVehicleImages(vehicle: Vehicle): Vehicle {
  const seen = new Set<string>();

  const normalize = (url: string) => {
    const cleaned = normalizeVehicleImageUrl(url.trim());
    if (!/^https?:\/\//i.test(cleaned)) return null;
    if (decorativeWillhaben.test(cleaned)) return null;
    if (thumbSuffix.test(cleaned)) return null;
    if (seen.has(cleaned)) return null;
    seen.add(cleaned);
    return cleaned;
  };

  const imageDetails = (vehicle.imageDetails ?? [])
    .map((detail) => {
      const url = normalize(detail.url);
      return url ? { ...detail, url } : null;
    })
    .filter((detail): detail is VehicleImage => Boolean(detail));

  const ogImage = imageDetails.find((detail) => detail.source === "og:image")?.url;
  const images = vehicle.images.map(normalize).filter((url): url is string => Boolean(url));
  const orderedImages = ogImage ? [ogImage, ...images.filter((url) => url !== ogImage)] : images;

  return {
    ...vehicle,
    images: orderedImages.length ? orderedImages : vehicle.images.map(normalizeVehicleImageUrl),
    imageDetails: imageDetails.length ? imageDetails : vehicle.imageDetails
  };
}

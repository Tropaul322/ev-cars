"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  VEHICLE_IMAGE_PLACEHOLDER,
  buildVehicleImageCandidates
} from "@/lib/vehicle-images";

type VehicleImageProps = {
  images: string[];
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  sizes?: string;
};

export function VehicleImage({
  images,
  alt,
  className,
  width,
  height,
  priority,
  sizes
}: VehicleImageProps) {
  const candidates = useMemo(() => buildVehicleImageCandidates(images), [images]);
  const candidatesKey = candidates.join("|");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [candidatesKey]);

  const src = candidates[Math.min(index, candidates.length - 1)] ?? VEHICLE_IMAGE_PLACEHOLDER;
  const isRemoteImage = src.startsWith("http://") || src.startsWith("https://");
  const isPlaceholder = src === VEHICLE_IMAGE_PLACEHOLDER;

  return (
    <Image
      src={src}
      alt={isPlaceholder ? "No vehicle photo available" : alt}
      width={width}
      height={height}
      sizes={sizes}
      priority={priority}
      unoptimized={isRemoteImage}
      className={className}
      onError={() => {
        setIndex((current) => (current < candidates.length - 1 ? current + 1 : current));
      }}
    />
  );
}

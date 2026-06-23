import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: appDir,
  reactStrictMode: true,
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cache.willhaben.at" },
      { protocol: "https", hostname: "groupcms-services-api.porsche-holding.com" },
      { protocol: "https", hostname: "prod.pictures.autoscout24.net" },
      { protocol: "https", hostname: "www.bmw-boerse.at" },
      { protocol: "https", hostname: "i.pravatar.cc" }
    ]
  }
};

export default nextConfig;

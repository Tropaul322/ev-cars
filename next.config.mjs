import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: appDir,
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cache.willhaben.at" },
      { protocol: "https", hostname: "groupcms-services-api.porsche-holding.com" },
      { protocol: "https", hostname: "prod.pictures.autoscout24.net" },
      { protocol: "https", hostname: "www.bmw-boerse.at" }
    ]
  }
};

export default nextConfig;

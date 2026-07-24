import type { Metadata } from "next";
import { Manrope, Sora, Geist } from "next/font/google";
import { DemoRegistrationGate } from "@/components/demo-registration-gate";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-sora",
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "FlowRyd",
  description: "The first car-buying experience for your life.",
  applicationName: "FlowRyd",
  icons: {
    icon: [{ url: "/favicon.png", sizes: "244x244", type: "image/png" }],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "244x244", type: "image/png" },
    ],
  },
  openGraph: {
    title: "FlowRyd",
    description: "The first car-buying experience for your life.",
    siteName: "FlowRyd",
    type: "website",
    images: [
      {
        url: "/flowryd-og.png",
        width: 2400,
        height: 1260,
        alt: "FlowRyd electric car-buying experience preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FlowRyd",
    description: "The first car-buying experience for your life.",
    images: ["/flowryd-og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(manrope.variable, sora.variable, "font-sans", geist.variable)}>
      <body>
        {children}
        <DemoRegistrationGate />
      </body>
    </html>
  );
}

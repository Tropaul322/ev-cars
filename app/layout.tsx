import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import { DemoRegistrationGate } from "@/components/demo-registration-gate";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-sora",
});

export const metadata: Metadata = {
  title: "FlowRyd EV Alpha",
  description: "AI-assisted electric vehicle matching for the Austria pilot.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${sora.variable}`}>
      <body>
        {children}
        <DemoRegistrationGate />
      </body>
    </html>
  );
}

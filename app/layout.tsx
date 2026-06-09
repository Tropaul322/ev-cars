import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlowRyd EV Alpha",
  description: "AI-assisted electric vehicle matching for the Austria pilot."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "UPI Business Autopilot",
  description: "Bills, partial payments, promises and verified cash-in for Indian merchants.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0a6b4d", interactiveWidget: "resizes-content" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className="antialiased">
      <body className="font-sans">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

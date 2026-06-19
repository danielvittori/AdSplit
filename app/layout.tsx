import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdSplit — the chart for ads that haven't run yet",
  description:
    "Open a battle of 2-4 ad creatives. Viewers stake $0.05-0.20 in native USDC on the one that hooks them — a real-money pre-launch signal. An autonomous Arc agent pays the winning creative's author. On ARC.",
  keywords: "AdSplit, ARC, USDC, ads, creative testing, A/B, prediction, agentic, payments, web3",
};

export const viewport: Viewport = {
  themeColor: "#0b0710",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

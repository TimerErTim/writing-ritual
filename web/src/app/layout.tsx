import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aether: The Graveyard of Voices",
  description: "Anonymous real-time séance — reanimate the voices of the past.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0a0a0a] text-[#22c55e]">{children}</body>
    </html>
  );
}

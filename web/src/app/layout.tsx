import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Ritual",
  description: "Collaborative writing ritual",
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

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MangaReplacer",
  description: "Replace manga characters while preserving style",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}

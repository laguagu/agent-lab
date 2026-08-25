import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skill Lab",
  description: "Run Agent Skills in your own container",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fi" suppressHydrationWarning>
      <body className="h-full">{children}</body>
    </html>
  );
}

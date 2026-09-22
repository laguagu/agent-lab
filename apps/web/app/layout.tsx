import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Lab",
  description: "Run sandboxed agents locally, three ways",
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

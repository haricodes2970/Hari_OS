import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hari OS",
  description: "A personal operating system that makes daily state visible.",
  applicationName: "Hari OS",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <span className="site-name">Hari OS</span>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/AppShell";

import { ServiceWorkerRegistration } from "./service-worker-registration";
import "./globals.css";

/**
 * The document's own metadata, and the icon links.
 *
 * `icons` is written out rather than left to a file convention because the same files are named by
 * the manifest route, and one list of paths in one place is easier to keep correct than two
 * conventions that happen to produce the same URLs. `favicon.png` is the 32px file `npm run icons`
 * generates; without it the browser requests `/favicon.ico` and gets a 404 on every page load.
 *
 * `apple-touch-icon` is declared for the same reason: iOS does not read the manifest, so an added
 * to the Home Screen would otherwise use a screenshot of the page.
 *
 * `themeColor` matches the shell's dark rail. On a phone this is the strip above the browser
 * chrome, so the difference between a dark bar and a white one over a dark header is the whole
 * difference between an installed application and a web page.
 */
export const metadata: Metadata = {
  title: "Hari OS",
  description: "A personal operating system that makes daily state visible.",
  applicationName: "Hari OS",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#16181d",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/*
          The only client component that renders anything. See
          `service-worker-registration.tsx` for why registration cannot live here.
        */}
        <ServiceWorkerRegistration />
        {/*
          The shell wraps every page so the rail is defined once. It is the other client component
          in the tree, and it exists only because a layout is never told which page it is wrapping;
          `AppShell.tsx` explains the trade in full.
        */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

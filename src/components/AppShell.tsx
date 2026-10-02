"use client";

/**
 * The application shell: the dark rail on desktop, the top bar and scroller on a narrow screen.
 *
 * ## Why this is the one client component
 *
 * Everything else in the tree is a Server Component, and the existing `Nav` was written that way
 * on purpose: it received the current path as a prop so no page had to pay for hydration just to
 * underline a tab.
 *
 * The shell is different, and the difference is structural. It lives in `layout.tsx`, which wraps
 * every page and — in the App Router — is never told which page it is wrapping. There is no
 * prop to pass the path down from. `usePathname()` is the only way to know which rail item is
 * current, and it is only available on the client.
 *
 * So the choice was between this component and one that marks the active page somewhere other
 * than the navigation. This is the smaller cost: it renders links and nothing else, it holds no
 * data, and the `{children}` it wraps stay server-rendered — every page's data is still read in
 * `src/features` on the server and only the finished markup is passed through.
 *
 * ## What it deliberately does not do
 *
 * No layout is decided here that a page needs. The rail is fixed-width, the content column is
 * capped and centred in CSS, and the only breakpoint decision is one media query. A page never
 * asks this component for anything.
 */
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { NAV_LINKS, SETTINGS_LINK, isActiveLink } from "./NavLinks";

/**
 * Inline icons, one per destination.
 *
 * Drawn as paths rather than pulled from an icon package: the set is eight glyphs, a dependency
 * would add weight and a build step for no gain, and `currentColor` means they inherit the rail's
 * own light-on-dark treatment without a second stylesheet. Every glyph is decorative — the label
 * beside it carries the meaning — so each is `aria-hidden`.
 */
function Icon({ name }: { name: string }) {
  const common = {
    className: "nav-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: "false" as const,
  };

  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "kitchen":
      return (
        <svg {...common}>
          <path d="M4 3h16l-1.6 8.2a3 3 0 0 1-2.95 2.55H8.55A3 3 0 0 1 5.6 11.2Z" />
          <path d="M7 13.75V21" />
          <path d="M8.6 3v3.2M15.4 3v3.2" />
        </svg>
      );
    case "expenses":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M3 9.5h18" />
          <path d="M16.5 14.5h1.5" />
        </svg>
      );
    case "routine":
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
          <path d="M3 9.5h18M8 3v3M16 3v3" />
          <path d="M8.5 14.5l2 2 4-4" />
        </svg>
      );
    case "skills":
      return (
        <svg {...common}>
          <path d="M12 3.5 14.4 9l6.1.6-4.6 4 1.4 5.9L12 16.4 6.7 19.5l1.4-5.9-4.6-4L9.6 9Z" />
        </svg>
      );
    case "habits":
      return (
        <svg {...common}>
          <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
          <path d="M20.5 4v4.5H16" />
        </svg>
      );
    case "diary":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <circle cx="8.75" cy="9.75" r="1.75" />
          <path d="M4 17.5 9.5 12l3.5 3.5L16 13l4 4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
        </svg>
      );
    default:
      return null;
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const links = NAV_LINKS.map((link) => ({
    ...link,
    current: isActiveLink(pathname, link.href),
  }));

  return (
    <div className="shell">
      {/*
        The rail. `display: none` below 1024px, where the top bar and scroller below take over.
      */}
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <span className="shell-mark" aria-hidden="true">
            HO
          </span>
          <span className="shell-name">Hari OS</span>
        </div>
        <p className="shell-tagline">Your day, made visible.</p>

        <nav className="nav" aria-label="Sections">
          <span className="nav-label">Modules</span>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={link.current ? "nav-link nav-link-active" : "nav-link"}
              aria-current={link.current ? "page" : undefined}
            >
              <Icon name={link.icon} />
              <span>{link.label}</span>
            </a>
          ))}
        </nav>

        <div className="shell-sidebar-footer">
          <nav aria-label="Settings">
            <a
              href={SETTINGS_LINK.href}
              className={
                isActiveLink(pathname, SETTINGS_LINK.href)
                  ? "nav-link nav-link-active"
                  : "nav-link"
              }
              aria-current={
                isActiveLink(pathname, SETTINGS_LINK.href) ? "page" : undefined
              }
            >
              <Icon name={SETTINGS_LINK.icon} />
              <span>{SETTINGS_LINK.label}</span>
            </a>
          </nav>
        </div>
      </aside>

      {/* The brand, for widths where the rail is gone. */}
      <div className="shell-topbar">
        <span className="shell-mark" aria-hidden="true">
          HO
        </span>
        <span className="shell-name">Hari OS</span>
      </div>

      {/*
        The same links, wrapping onto two short rows. Not the desktop rail squeezed: at 320px a
        15rem column leaves 160px of content, and the command box — the most important control in
        the application — would be the thing that had to shrink.

        Settings is in this row as well as in the rail's footer. When the rail is hidden it is
        hidden entirely, and a page nothing can navigate to is not a page; the desktop footer keeps
        it out of the module list, and this keeps it reachable.
      */}
      <nav className="shell-mobile-nav" aria-label="Sections">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className={link.current ? "nav-link nav-link-active" : "nav-link"}
            aria-current={link.current ? "page" : undefined}
          >
            {link.label}
          </a>
        ))}
        <a
          href={SETTINGS_LINK.href}
          className={
            isActiveLink(pathname, SETTINGS_LINK.href)
              ? "nav-link nav-link-active"
              : "nav-link"
          }
          aria-current={
            isActiveLink(pathname, SETTINGS_LINK.href) ? "page" : undefined
          }
        >
          {SETTINGS_LINK.label}
        </a>
      </nav>

      <div className="shell-main">{children}</div>
    </div>
  );
}

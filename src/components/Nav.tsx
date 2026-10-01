/**
 * Navigation between the three pages that exist in this phase.
 *
 * A Server Component, since it needs nothing from the browser. `usePathname` would make it a
 * Client Component and hand every page a client boundary purely to underline the current
 * tab; receiving the path as a prop costs nothing instead.
 */
export type NavProps = {
  readonly currentPath: string;
};

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/kitchen", label: "Kitchen" },
  { href: "/expenses", label: "Expenses" },
  { href: "/routine", label: "Routine" },
] as const;

export function Nav({ currentPath }: NavProps) {
  return (
    <nav className="nav" aria-label="Sections">
      {LINKS.map((link) => {
        // Exact match for the dashboard, so `/` does not read as current on every page.
        const active =
          link.href === "/"
            ? currentPath === "/"
            : currentPath.startsWith(link.href);

        return (
          <a
            key={link.href}
            href={link.href}
            className={active ? "nav-link nav-link-active" : "nav-link"}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * Navigation between the pages that exist.
 *
 * A Server Component, since it needs nothing from the browser. `usePathname` would make it a
 * Client Component and hand every page a client boundary purely to underline the current
 * tab; receiving the path as a prop costs nothing instead.
 *
 * ## Two Phase 7 links, both to reach a real page
 *
 * `Skills` is the replacement-activity list, which is what the Dashboard's urge entry point opens.
 * `Habits` is where habits, screen time, and the private log live. Neither is a
 * modal or a query string on the Dashboard: they are pages, because the PRD asks for a full list
 * the user reads, and a page is what a list deserves.
 *
 * The order follows the order of a day, with Skills after the records it replaces and `Diary`
 * last: the photos are the day's record, and the notes on them are what the day left behind.
 */
export type NavProps = {
  readonly currentPath: string;
};

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/kitchen", label: "Kitchen" },
  { href: "/expenses", label: "Expenses" },
  { href: "/routine", label: "Routine" },
  { href: "/habits", label: "Habits" },
  { href: "/skills", label: "Skills" },
  { href: "/diary", label: "Diary" },
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

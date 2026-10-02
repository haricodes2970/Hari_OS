/**
 * The navigation table, as data rather than as markup.
 *
 * It lives apart from `AppShell.tsx` so this file stays a Server Component and the link list can be
 * read — and its order checked — without pulling the client boundary across everything that
 * imports it.
 *
 * ## The order is the order of a day
 *
 * The Dashboard opens the morning. Kitchen and Expenses are what the day consumes. Routine is
 * tonight's plan. Skills is the replacement list, and it sits directly after the records it
 * replaces, because the moment someone says they feel like scrolling is the moment the list has to
 * be reachable. Habits is where the day's habits are recorded. Diary is last: the photographs and
 * the words beside them are what the day left behind.
 *
 * No item is ever marked as a recommendation, and the list carries no property in which one could
 * be expressed.
 */

export type NavLink = {
  readonly href: string;
  readonly label: string;
  /** Matches the inline icon set in `AppShell.tsx`. */
  readonly icon: string;
};

export const NAV_LINKS: readonly NavLink[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/kitchen", label: "Kitchen", icon: "kitchen" },
  { href: "/expenses", label: "Expenses", icon: "expenses" },
  { href: "/routine", label: "Routine", icon: "routine" },
  { href: "/skills", label: "Skills", icon: "skills" },
  { href: "/habits", label: "Habits", icon: "habits" },
  { href: "/diary", label: "Diary", icon: "diary" },
] as const;

/**
 * Settings lives apart from the modules because it is not part of the day. It is the one link in
 * the rail's footer, and the only place in this application where a configuration fact is
 * displayed rather than a record of something that happened.
 */
export const SETTINGS_LINK: NavLink = {
  href: "/settings",
  label: "Settings",
  icon: "settings",
};

/**
 * Whether a link points at the page being shown.
 *
 * `/` matches only itself. Without that special case the Dashboard would read as current on every
 * page, because every other path starts with a slash.
 */
export function isActiveLink(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

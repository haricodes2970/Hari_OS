/**
 * The primitives every page is assembled from.
 *
 * These exist so that eight pages look like one application. Before them, each page styled its own
 * headers, cards, empty states, and status marks, which is why two sections of the same screen
 * could disagree about what a card looked like.
 *
 * ## They decide nothing
 *
 * Every one of these is presentational: it renders the props it is given and imports no feature,
 * no repository, and no domain rule. A page still reads through `src/features` and still formats
 * through the domain's own helpers. These components cannot introduce a number, and they cannot
 * compute one — which is why a statistic on a card is passed in already computed.
 *
 * That constraint is what lets a page be a composition of these and still satisfy the project's
 * rule that a page formats nothing and compares nothing.
 */
import type { ReactNode } from "react";

/* ---------------------------------------------------------------------------
   Page header
   --------------------------------------------------------------------------- */

export type PageHeaderProps = {
  /** The page's own name. Rendered as the `h1`. */
  readonly title: string;
  /** One sentence saying what the page is for. */
  readonly description?: ReactNode;
  /** Restrained controls on the right: a date, a link, a count. */
  readonly aside?: ReactNode;
};

/**
 * The top of every page: title, one supporting line, and whatever belongs beside it.
 *
 * `h1` lives here rather than in each page so the heading hierarchy is identical everywhere. A
 * page that needs a second heading starts its sections with `Section`, which is an `h2`.
 */
export function PageHeader({ title, description, aside }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1 className="page-title">{title}</h1>
        {description === undefined ? null : (
          <p className="page-description">{description}</p>
        )}
      </div>
      {aside === undefined ? null : aside}
    </header>
  );
}

/* ---------------------------------------------------------------------------
   Section
   --------------------------------------------------------------------------- */

/**
 * A titled group of content. One `h2` per section, so the document outline is the page's own
 * structure and not an accident of nesting.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  readonly title?: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  /** Set when something else on the page links straight to this section. */
  readonly id?: string;
}) {
  return (
    <section
      className={className === undefined ? "section" : className}
      id={id}
    >
      {title === undefined ? null : (
        <div className="section-head">
          <div className="stack-sm">
            <h2 className="section-title">{title}</h2>
            {description === undefined ? null : (
              <p className="muted">{description}</p>
            )}
          </div>
          {actions === undefined ? null : actions}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------------------
   Card
   --------------------------------------------------------------------------- */

export type CardProps = {
  readonly title?: string;
  /** A status pill or a count, top-right of the card. */
  readonly aside?: ReactNode;
  /** Puts a link at the bottom of the card, out of the content's way. */
  readonly foot?: ReactNode;
  /** A 1rem glyph rendered before the title. Decorative; the title carries the name. */
  readonly icon?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
};

/**
 * One surface with one idea on it.
 *
 * The `title` is an `h3` because a card always sits inside a `Section`, which is the `h2`. A card
 * rendered directly under the page header would break that order, so `Section` is used even when a
 * card is the whole page.
 */
export function Card({
  title,
  aside,
  foot,
  icon,
  className,
  children,
}: CardProps) {
  return (
    <article className={className === undefined ? "card" : `card ${className}`}>
      {title === undefined ? null : (
        <div className="card-head">
          <div className="card-title-row">
            {icon === undefined ? null : (
              <span className="card-icon" aria-hidden="true">
                {icon}
              </span>
            )}
            <h3 className="card-title">{title}</h3>
          </div>
          {aside === undefined ? null : (
            <div className="card-aside">
              {aside}
              <span className="card-aside-arrow" aria-hidden="true">
                →
              </span>
            </div>
          )}
        </div>
      )}
      {children}
      {foot === undefined ? null : <div className="card-foot">{foot}</div>}
    </article>
  );
}

/**
 * The link that goes deeper from a card.
 *
 * Its own component so every card ends with the same shape and the same affordance — a coloured
 * phrase with an arrow — rather than a bare underlined word in a slightly different place each
 * time.
 */
export function CardLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <a className="card-link" href={href}>
      {children}
      <span aria-hidden="true">→</span>
    </a>
  );
}

/* ---------------------------------------------------------------------------
   Statistic
   --------------------------------------------------------------------------- */

/**
 * A figure, with its label and an optional note underneath.
 *
 * `value` is already formatted by whoever produced it — a balance from `formatMinorUnits`, a
 * duration from `formatDuration`. This component renders text and nothing else, so it is incapable
 * of producing a number the domain did not already agree on.
 */
export function Stat({
  label,
  value,
  note,
  tone,
  size = "lg",
}: {
  /** What the number is. Always present: a figure with no label is a riddle. */
  readonly label: string;
  readonly value: string;
  /** One short clause saying what the figure is or is not. */
  readonly note?: ReactNode;
  /** `negative` for a real problem such as an overdrawn account. */
  readonly tone?: "default" | "negative";
  readonly size?: "lg" | "sm";
}) {
  return (
    <div className="stack-sm">
      <span className="eyebrow">{label}</span>
      <span
        className={[
          size === "lg" ? "tile-value" : "tile-value-sm",
          tone === "negative" ? "negative-text" : "",
        ]
          .filter((part) => part !== "")
          .join(" ")}
      >
        {value}
      </span>
      {note === undefined ? null : <p className="meta">{note}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Status
   --------------------------------------------------------------------------- */

export type Tone = "neutral" | "accent" | "positive" | "warning" | "danger";

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  neutral: "badge badge-ok",
  accent: "badge badge-accent",
  positive: "badge badge-positive",
  warning: "badge badge-low",
  danger: "badge badge-danger",
};

/**
 * A state, in a pill.
 *
 * Four tones, each meaning one thing: `neutral` is simply a fact, `positive` is done, `warning` is
 * something the domain itself flagged, and `danger` is a real problem. Nothing is coloured for
 * decoration, so a coloured pill always carries information.
 */
export function Status({
  tone = "neutral",
  children,
}: {
  readonly tone?: Tone;
  readonly children: ReactNode;
}) {
  return <span className={TONE_CLASS[tone]}>{children}</span>;
}

/* ---------------------------------------------------------------------------
   Empty state
   --------------------------------------------------------------------------- */

/**
 * What a page says when there is nothing stored.
 *
 * Two rules, both of which this component exists to enforce. It is quiet prose rather than an
 * alert, because an empty list is a normal state. And it never fills itself with example data: a
 * screen showing invented rows would be claiming the user has onions when they do not, and the
 * next page to read the same pattern would be claiming something else.
 */
export function Empty({
  children,
  compact = false,
}: {
  readonly children: ReactNode;
  readonly compact?: boolean;
}) {
  return (
    <p className={compact ? "empty empty-compact" : "empty"}>{children}</p>
  );
}

/* ---------------------------------------------------------------------------
   Progress bar
   --------------------------------------------------------------------------- */

/**
 * A bar against a target, with the accessible value on the element.
 *
 * Used for exactly one thing in this application — laundry against its
 * twice-a-week target — and it is never rendered for anything from the private log. `percent` is
 * the figure the domain already computed (`laundryProgress`); this draws it and states it.
 */
export function ProgressBar({
  value,
  max,
  percent,
  label,
}: {
  readonly value: number;
  readonly max: number;
  readonly percent: number;
  readonly label: string;
}) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={`${Math.min(value, max)} of ${max}`}
      aria-label={label}
    >
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Breakdown bar
   --------------------------------------------------------------------------- */

/**
 * A labelled bar for a share of a total, drawn from a figure that already exists.
 *
 * `share` is the page's own proportion of the day's total, used only for the width of a bar. The
 * amount beside it is formatted by the domain, so the number a reader acts on was never computed
 * here — the bar cannot add up to something different from the list above it, because it does not
 * add anything up.
 */
export function BreakdownRow({
  label,
  value,
  share,
  tone = "accent",
}: {
  readonly label: string;
  /** Already formatted by the domain. */
  readonly value: string;
  /** A CSS percentage for the bar's width. Zero renders an empty bar, not a bar. */
  readonly share: number;
  readonly tone?: "accent" | "muted";
}) {
  return (
    <div className="viz-row">
      <span className="viz-label" title={label}>
        {label}
      </span>
      <span className="viz-track">
        <span
          className={tone === "muted" ? "viz-fill viz-fill-muted" : "viz-fill"}
          style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
        />
      </span>
      <span className="viz-value">{value}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Grid
   --------------------------------------------------------------------------- */

/** The responsive card grid. One column on a phone, three or four on a desktop. */
export function CardGrid({
  children,
  wide = false,
}: {
  readonly children: ReactNode;
  readonly wide?: boolean;
}) {
  return (
    <div className={wide ? "card-grid card-grid-wide" : "card-grid"}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Column chart
   --------------------------------------------------------------------------- */

export type ColumnChartProps = {
  /**
   * One entry per real category. Each `total` is the amount the domain formatted, and `value` is
   * that same amount as text. The bar's height is derived from these figures, inside this component,
   * so the page that supplies them never has to work out a maximum of its own.
   */
  readonly columns: readonly {
    readonly label: string;
    /** The amount in minor units, used only to compare the heights of these columns. */
    readonly total: number;
    /** Already formatted by the domain. */
    readonly value: string;
    readonly tone?: "accent" | "muted";
  }[];
};

/**
 * Vertical columns for the Expenses composition.
 *
 * It draws, it does not analyse: no axis, no gridline, no scale, and no total of its own. Each
 * column is a share of the largest figure in this set — a comparison between bars on one screen,
 * never a sum and never a claim about anything outside them.
 *
 * The amount under each column is the text the domain formatted, so a column cannot disagree with
 * the list beside it. And a caller with nothing to show gets the empty state rather than an empty
 * chart frame, because a chart with no data in it reads as "you spent nothing" when it may only
 * mean "nothing has been recorded yet".
 */
export function ColumnChart({ columns }: ColumnChartProps) {
  const tallest = columns.reduce(
    (max, column) => Math.max(max, column.total),
    0,
  );

  return (
    <div className="column-chart">
      {columns.map((column) => (
        <div className="column" key={column.label}>
          <span className="column-value">{column.value}</span>
          <span className="column-track">
            <span
              className={
                column.tone === "muted"
                  ? "column-fill column-fill-muted"
                  : "column-fill"
              }
              style={{
                height: `${
                  tallest === 0
                    ? 0
                    : Math.max(0, Math.min(100, (column.total / tallest) * 100))
                }%`,
              }}
            />
          </span>
          <span className="column-label" title={column.label}>
            {column.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Skill bars
   --------------------------------------------------------------------------- */

/**
 * One thin bar per skill: its name, its share of the longest-logged skill's time, and the duration
 * the domain formatted.
 *
 * The maximum is worked out here rather than in the page for the same reason as the column chart:
 * a page that finds the largest of a set is already computing over the data, and this application's
 * pages are not allowed to. The bar compares rows on one screen. It is not a score, not a
 * percentage, and not a threshold — no skill is labelled against the widest bar.
 */
export function SkillBars({
  skills,
}: {
  readonly skills: readonly {
    readonly key: string;
    readonly label: string;
    /** The skill's total logged minutes, or `null` when it has never been logged. */
    readonly minutes: number | null;
    /** Already formatted by the domain. */
    readonly value: string;
  }[];
}) {
  const longest = skills.reduce(
    (max, skill) => Math.max(max, skill.minutes ?? 0),
    0,
  );

  return (
    <ul className="mini-list">
      {skills.map((skill) => (
        <li className="skill-line" key={skill.key}>
          <span className="mini-row-label">{skill.label}</span>
          {skill.minutes === null || skill.minutes === 0 ? (
            <span className="meta">Not logged yet</span>
          ) : (
            <>
              <span className="viz-track">
                <span
                  className="viz-fill"
                  style={{
                    width: `${
                      longest === 0
                        ? 0
                        : Math.max(
                            0,
                            Math.min(
                              100,
                              ((skill.minutes ?? 0) / longest) * 100,
                            ),
                          )
                    }%`,
                  }}
                />
              </span>
              <span className="viz-value">{skill.value}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
/* ---------------------------------------------------------------------------
   Filter tabs
   --------------------------------------------------------------------------- */

/**
 * Filters that are links, not client state.
 *
 * A tab carries the filter in its own query string, so a filtered view survives a refresh, the back
 * button, and being copied to somebody else — and it works before hydration because it never needed
 * hydration. Each entry states its own count, because "Low stock (2)" answers the question the tab
 * was clicked to ask without opening it.
 */
export function FilterTabs({
  tabs,
}: {
  readonly tabs: readonly {
    readonly label: string;
    readonly href: string;
    readonly active: boolean;
    /** The number of rows this filter would show. Omitted for the unfiltered view. */
    readonly count?: number;
  }[];
}) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <a
          className={tab.active ? "tab tab-active" : "tab"}
          href={tab.href}
          key={tab.label}
          aria-current={tab.active ? "true" : undefined}
        >
          {tab.label}
          {tab.count === undefined ? null : (
            <span className="tab-count">{tab.count}</span>
          )}
        </a>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Status mark
   --------------------------------------------------------------------------- */

/**
 * Done or not, in one circle.
 *
 * `aria-hidden` on purpose: the row it sits in already states the outcome in words, and a symbol on
 * its own would tell a screen-reader user nothing. Green here means a neutral habit was recorded —
 * never a private behaviour, which never leaves the Diary, and never a score.
 */
export function Mark({ done }: { readonly done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={done ? "mark mark-done" : "mark mark-open"}
    >
      {done ? "✓" : "·"}
    </span>
  );
}

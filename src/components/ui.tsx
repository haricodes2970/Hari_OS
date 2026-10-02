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
}: {
  readonly title?: string;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={className === undefined ? "section" : className}>
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
export function Card({ title, aside, foot, className, children }: CardProps) {
  return (
    <article className={className === undefined ? "card" : `card ${className}`}>
      {title === undefined ? null : (
        <div className="card-head">
          <h3 className="card-title">{title}</h3>
          {aside === undefined ? null : aside}
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

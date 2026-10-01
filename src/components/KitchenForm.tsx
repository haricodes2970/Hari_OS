/**
 * A plain form posting to the Kitchen endpoint.
 *
 * A Server Component with `method="post"` and no client JavaScript, for the same reason
 * `CommandForm` has none: React replaces a form's `action` when it owns submission, so an
 * `onSubmit` handler silently turns the only working path into a scripts-only path. The
 * endpoint answers `303` back to `/kitchen` carrying the outcome, and the page renders it.
 *
 * ## What it knows
 *
 * Field names and nothing else. It does not know what a quantity is, whether a unit is
 * compatible, or whether a threshold is sensible — the domain decides all of that, and this
 * component cannot reach it. The item's id travels as a hidden field so a form left open across
 * a rename still acts on the row it was opened for.
 */
import type { ReactNode } from "react";

export type KitchenField = {
  readonly name: string;
  readonly label: string;
  readonly kind: "text" | "number";
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly min?: string;
  readonly step?: string;
  /** Extra guidance shown under the input. */
  readonly hint?: string;
};

export type KitchenFormProps = {
  /** Which Kitchen operation this submits. A closed set the endpoint validates. */
  readonly operation: "add_item" | "set_threshold" | "rename" | "correct";
  readonly fields?: readonly KitchenField[];
  readonly hidden?: Readonly<Record<string, string>>;
  readonly submitLabel: string;
  readonly heading?: string;
  readonly children?: ReactNode;
  /** Renders the form inline rather than as its own block. Used inside a table cell. */
  readonly compact?: boolean;
};

const ENDPOINT = "/api/kitchen";

export function KitchenForm({
  operation,
  fields = [],
  hidden = {},
  submitLabel,
  heading,
  children,
  compact = false,
}: KitchenFormProps) {
  return (
    <form
      method="post"
      action={ENDPOINT}
      className={compact ? "inline-form" : undefined}
    >
      <input type="hidden" name="operation" value={operation} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {heading === undefined ? null : <h3>{heading}</h3>}

      {fields.map((field) => (
        <label key={field.name} className="field">
          <span>{field.label}</span>
          <input
            name={field.name}
            type={field.kind}
            defaultValue={field.defaultValue}
            placeholder={field.placeholder}
            min={field.min}
            step={field.step}
            required={false}
          />
          {field.hint === undefined ? null : (
            <span className="muted">{field.hint}</span>
          )}
        </label>
      ))}

      {children}
      <button type="submit">{submitLabel}</button>
    </form>
  );
}

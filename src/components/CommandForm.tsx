/**
 * The command form, shared by the Kitchen and Expenses pages.
 *
 * A Server Component with a plain `method="post"` form. No client JavaScript, no
 * `useActionState`, no hydration for this component at all.
 *
 * ## Why there is no client-side submit handler
 *
 * An earlier version of this file intercepted the submit with `useActionState` to report the
 * result in place. It was removed, because doing so silently destroyed the thing it was
 * supposed to enhance: React replaces a form's `action` with a stub when it owns submission,
 * so the form only worked with scripts enabled and no longer posted to the endpoint at all.
 * Progressive enhancement was not an enhancement here — it was the only path.
 *
 * A plain post has none of that. Without JavaScript the browser posts to
 * `POST /api/commands`, which answers `303 See Other` back to the originating page with the
 * outcome in the query string, and `OutcomeBanner` renders it. With JavaScript, the same
 * thing happens a little more slowly, as a full page load. Identical behaviour either way,
 * one code path, nothing to keep in step.
 *
 * The cost is a page reload per command. For a single-user localhost application that is the
 * right trade: the reload is how the user sees the new quantity anyway, since that data
 * lives in Server Components.
 *
 * ## What this component deliberately cannot do
 *
 * It knows nothing about quantities, units, money, or balances. It collects strings, names
 * them exactly as the command contract names them, and renders the inputs. The domain
 * decides what is allowed, and the endpoint decides what is stored. No id, timestamp, or
 * balance is computed here, and no client-side code exists here to compute one.
 */
export type CommandField = {
  /** The contract's own field name, used verbatim as the input's name. */
  readonly name: string;
  readonly label: string;
  readonly kind: "text" | "number" | "select";
  readonly min?: string;
  readonly step?: string;
  readonly placeholder?: string;
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
};

export type CommandFormProps = {
  /** The command kind, sent as a hidden field. */
  readonly kind: string;
  /** Where the endpoint should send the browser back to. */
  readonly returnTo: string;
  readonly fields: readonly CommandField[];
  readonly submitLabel: string;
  readonly heading?: string;
};

/** The single endpoint every command is posted to. */
const ENDPOINT = "/api/commands";

export function CommandForm({
  kind,
  returnTo,
  fields,
  submitLabel,
  heading,
}: CommandFormProps) {
  return (
    <form className="command-form" method="post" action={ENDPOINT}>
      <input type="hidden" name="kind" value={kind} />
      {/* Where to land afterwards. The endpoint treats this as untrusted and refuses
          anything that is not a same-site path. */}
      <input type="hidden" name="next" value={returnTo} />

      {heading === undefined ? null : (
        <h2 className="form-heading">{heading}</h2>
      )}

      <div className="field-row">
        {fields.map((field) => (
          <label className="field" key={field.name}>
            <span className="field-label">{field.label}</span>
            {field.kind === "select" ? (
              <select
                name={field.name}
                defaultValue={field.options?.[0]?.value}
                required
              >
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={field.name}
                type={field.kind === "number" ? "number" : "text"}
                inputMode={field.kind === "number" ? "decimal" : "text"}
                min={field.min}
                step={field.step}
                placeholder={field.placeholder}
                required
              />
            )}
          </label>
        ))}
      </div>

      <button type="submit">{submitLabel}</button>
    </form>
  );
}

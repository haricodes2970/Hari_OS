/**
 * The night check-in form.
 *
 * A Server Component with `method="post"` and no client JavaScript, for the reason
 * `KitchenForm` has none: React takes over a form's `action` when it owns submission, so an
 * `onSubmit` handler quietly turns the only working path into a scripts-only path.
 *
 * ## Why the phone question is a select and not a checkbox
 *
 * An unchecked checkbox sends **nothing**, so "I did not confirm it" and "I confirmed the phone
 * is inside" would arrive as the same absent field, and the server would have to guess which
 * one the user meant. A select always submits one of two words, so the submitted answer is the
 * answer the user read on screen. The route refuses anything else, including a missing field.
 *
 * The question is asked once, plainly, with no wording that implies the system is watching:
 * it records where the phone is, and nothing on this page counts, scores, or judges it.
 */
const ENDPOINT = "/api/routine";

export type RoutineFormProps = {
  /** The plan already written for tomorrow, offered as starting text. */
  readonly existing?: readonly string[];
  readonly submitLabel: string;
};

const TITLE_LABELS = ["First", "Second", "Third"] as const;

export function RoutineForm({ existing = [], submitLabel }: RoutineFormProps) {
  return (
    <form method="post" action={ENDPOINT}>
      <input type="hidden" name="operation" value="night_check_in" />

      {TITLE_LABELS.map((label, index) => (
        <label key={label} className="field">
          <span>{`${label} task`}</span>
          <input
            name={`title${index + 1}`}
            type="text"
            maxLength={120}
            defaultValue={existing[index]}
            placeholder="one thing to do tomorrow"
          />
          {index === 0 ? (
            <span className="muted">
              One to three. Leave a box empty to skip it.
            </span>
          ) : null}
        </label>
      ))}

      <label className="field">
        <span>Phone charging outside the bedroom?</span>
        <select name="phoneOutside" defaultValue="false">
          <option value="false">Not confirmed</option>
          <option value="true">Yes, it is outside</option>
        </select>
      </label>

      <button type="submit">{submitLabel}</button>
    </form>
  );
}

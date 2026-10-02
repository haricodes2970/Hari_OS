/**
 * The Photo Diary: every laundry photo, with the note the user wrote beside it.
 *
 * ## What this page is for
 *
 * PRD 6.6: "Digital diary: the laundry photo and daily notes form a visual timeline." This is the
 * timeline. The Habits page carries a short preview of the same pictures, because the habit record
 * and the picture belong together; this page is the one the note is written on.
 *
 * ## The photograph is the page
 *
 * The reference direction for this redesign is photo-first, and the layout follows it literally:
 * each entry is a card whose largest element is the image, at a fixed aspect ratio so a grid of
 * entries lines up no matter what shape the photographs are. The note sits underneath in the same
 * words the user typed, at a size meant to be read rather than skimmed.
 *
 * ## Why the note is a textarea with one submit button
 *
 * The note is a sentence or two, and editing one should not cost a page load for every keystroke.
 * So each entry is one plain `<form>` posting to `/api/photos/<id>/note`, and the textarea holds
 * the current text. `Save note` writes it; `Remove note` is a second form posting the same field
 * empty, which is how clearing works — the route has no separate delete, so there is nothing that
 * could clear a note by accident or leave one behind when a different button was pressed.
 *
 * ## Nothing here is written for the user
 *
 * There is no caption, no suggested text, no placeholder that looks like a sentence the
 * application had in mind, and no button that fills the box in. The placeholder is deliberately
 * generic ("your own words"): a diary entry that reads like it was written for the user is not
 * theirs. The only text in these boxes came from the user and came back from SQLite.
 *
 * ## What is not here
 *
 * No count of notes, no streak, no total, no "days journalled". `diarySummary` exists and says
 * what it means in a sentence, but a diary that scored itself would be the product this PRD is
 * arguing against. The private log's rule is the same rule, applied to a different feature.
 *
 * A Server Component: entries came from `readDiary`, and every change posts to one route.
 */
import { OutcomeBanner } from "@/components/OutcomeBanner";
import { Card, Empty, PageHeader, Section } from "@/components/ui";
import { MAX_DIARY_NOTE } from "@/domain/diary";
import { diarySummary, readDiary } from "@/features/habits/diary";

export const metadata = { title: "Diary · Hari OS" };
export const dynamic = "force-dynamic";

const RETURN_TO = "/diary";

/**
 * One entry's note form.
 *
 * `defaultValue` rather than `value`, because a textarea is uncontrolled here: the user edits it
 * locally and the stored text is only replaced when the form posts. There is no client component
 * and no state, so nothing re-renders over what someone is typing.
 */
function NoteForm({
  id,
  date,
  note,
}: {
  readonly id: number;
  readonly date: string;
  readonly note: string | null;
}) {
  return (
    <form
      className="stack-form"
      method="post"
      action={`/api/photos/${id}/note`}
    >
      <label className="field">
        <span className="field-label">
          Note for {date} (your own words, up to {MAX_DIARY_NOTE} characters)
        </span>
        <textarea
          name="note"
          className="diary-note"
          rows={3}
          maxLength={MAX_DIARY_NOTE}
          defaultValue={note ?? ""}
          placeholder="your own words"
        />
      </label>
      <input type="hidden" name="next" value={RETURN_TO} />
      <div className="button-row">
        <button type="submit">Save note</button>
      </div>
    </form>
  );
}

/**
 * The clear control: a second form posting `note` with nothing in it.
 *
 * Deliberately a **separate form** rather than a second submit button in the one above. A button
 * carrying `name="note"` would post alongside the textarea, so the request would contain the field
 * twice and `form.get("note")` would return the first — the text being edited, not the empty
 * string. The button would appear to clear the note and instead save it again, which is the worst
 * possible failure for a control whose whole purpose is removal.
 */
function ClearNoteForm({ id }: { readonly id: number }) {
  return (
    <form
      className="inline-form"
      method="post"
      action={`/api/photos/${id}/note`}
    >
      <input type="hidden" name="note" value="" />
      <input type="hidden" name="next" value={RETURN_TO} />
      <button type="submit" className="button-quiet">
        Remove note
      </button>
      <span className="meta">Removes the words. The photo stays.</span>
    </form>
  );
}

export default async function DiaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const entries = readDiary();

  return (
    <div className="page">
      <PageHeader
        title="Photo Diary"
        description="Every laundry photo, newest first, with whatever you wrote about it. Notes are yours alone: nothing here is written, suggested, or summarised for you."
        aside={<p className="meta">{diarySummary(entries)}</p>}
      />

      <OutcomeBanner searchParams={searchParams} />

      <Section title="Timeline">
        {entries.length === 0 ? (
          <Empty>
            No photos yet. Upload one on the <a href="/habits">Habits page</a>{" "}
            and the diary fills itself from there.
          </Empty>
        ) : (
          <ul className="card-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Card>
                  <span className="photo-frame">
                    {/* The src is the application's own URL, recorded with the row in Phase 7. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={entry.photoUrl}
                      alt={`Laundry recorded on ${entry.date}`}
                      className="diary-photo"
                      loading="lazy"
                    />
                  </span>

                  <h3 className="card-title">{entry.date}</h3>

                  {entry.note === null ? (
                    <p className="muted">No note on this one yet.</p>
                  ) : (
                    /*
                      The user's own words, rendered as text. React escapes it, the domain has
                      already refused control characters, and there is no path by which a note is
                      interpreted as markup.
                    */
                    <p className="diary-note-text">{entry.note}</p>
                  )}

                  <NoteForm id={entry.id} date={entry.date} note={entry.note} />
                  {entry.note === null ? null : <ClearNoteForm id={entry.id} />}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

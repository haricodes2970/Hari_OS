/**
 * The Settings page: the facts about this installation, and nothing that is not one.
 *
 * ## Why this page is a list of read-only facts rather than a form
 *
 * The temptation on a page called Settings is to build a preferences panel. This application has
 * almost no preferences, because almost everything it shows is a record of something that actually
 * happened, and a record is not a setting. Inventing toggles that do nothing would be worse than
 * having no Settings page at all.
 *
 * So every row below is a fact read from the running system: where the database is, whether the
 * parser is configured, how the server was started, and where the diary's photographs are served
 * from. Nothing here can be edited, and nothing here pretends to be editable.
 *
 * The one thing that genuinely *is* configuration — the OpenRouter credentials — is reported as a
 * state and pointed at the file it lives in, rather than rendered as an input box. A settings form
 * that wrote a secret into a text field would put the key somewhere it could be read, logged, or
 * committed. The project's own rule is that a credential is read by exactly one module and is
 * never displayed, and that rule is worth more than the convenience of a form.
 */
import { OutcomeBanner } from "@/components/OutcomeBanner";
import { Card, PageHeader, Section, Status } from "@/components/ui";
import { parserAvailability } from "@/features/chat/runtime";
import { PHOTO_LIMIT_BYTES } from "@/features/habits/photos";
import { MAX_DIARY_NOTE } from "@/domain/diary";
import { MAX_SKILLS } from "@/domain/skills";

export const metadata = { title: "Settings · Hari OS" };
export const dynamic = "force-dynamic";

const LIMIT_MB = Math.round(PHOTO_LIMIT_BYTES / (1024 * 1024));

type Fact = {
  readonly label: string;
  readonly value: string;
  readonly note: string;
};

/**
 * The fixed facts.
 *
 * These are compile-time constants rather than readings: the port is fixed by `start:hari`, the
 * limits are the same constants the validation and storage code use, and the paths are the ones
 * `.gitignore` already protects. They are shown so a person can see what the application's rules
 * are without having to read the source.
 */
const FACTS: readonly Fact[] = [
  {
    label: "Server",
    value: "http://localhost:6377",
    note: "Fixed by npm run start:hari. The server binds the loopback interface only, so it is not reachable from your network.",
  },
  {
    label: "Database",
    value: "data/hari-os.db",
    note: "SQLite, inside this project, git-ignored. It is created on first use and nothing needs setting up by hand. The repository is not a backup for it.",
  },
  {
    label: "Photographs",
    value: "data/uploads/",
    note: `Stored on disk and served through /api/photos. Files are named by the server, never by the browser, and are limited to ${LIMIT_MB} MB.`,
  },
  {
    label: "Diary note",
    value: `Up to ${MAX_DIARY_NOTE} characters`,
    note: "Written by you, read on the diary page only, and never summarised anywhere else.",
  },
  {
    label: "Skills list",
    value: `Up to ${MAX_SKILLS} skills`,
    note: "Yours to name. The full list is always shown when you ask for it, and nothing is ever chosen for you.",
  },
  {
    label: "Database path override",
    value: "HARI_OS_DB_PATH",
    note: "Optional, and unset here. It exists for tests and tooling; point it somewhere only if you mean to leave this project's data behind.",
  },
];

export default function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parser = parserAvailability();

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        description="How this installation is set up. These are facts about the running application, not preferences — there is nothing here to change."
      />

      <OutcomeBanner searchParams={searchParams} />

      <Section title="Natural language input">
        <Card>
          <div className="setting-row">
            <div className="setting-text">
              <span className="row-title">Parser</span>
              <span className="muted">
                {parser.available
                  ? "Configured. Sentences typed in the command box are read by OpenRouter."
                  : parser.reason}
              </span>
            </div>
            <Status tone={parser.available ? "positive" : "warning"}>
              {parser.available ? "Available" : "Not configured"}
            </Status>
          </div>

          {parser.available ? null : (
            <div className="setting-row">
              <div className="setting-text">
                <span className="row-title">How to turn it on</span>
                <span className="muted">
                  Copy <code>.env.example</code> to <code>.env.local</code> and
                  fill in <code>OPENROUTER_API_KEY</code> and{" "}
                  <code>OPENROUTER_MODEL</code>, then restart the server.
                </span>
              </div>
            </div>
          )}

          <p className="meta">
            The key is read on the server only. It is never displayed, never
            sent to the browser, and never written into this repository. Without
            it, every structured form on every page still works.
          </p>
        </Card>
      </Section>

      <Section title="Installation">
        <Card>
          <div className="setting-row">
            <div className="setting-text">
              <span className="row-title">Start</span>
              <span className="muted">
                Click Hari OS in your applications menu or on your Desktop, or
                run <code>npm run launch:hari</code>.
              </span>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-text">
              <span className="row-title">Stop</span>
              <span className="muted">
                The server keeps running after you close the launcher window.
                Run <code>npm run stop:hari</code> to stop it.
              </span>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-text">
              <span className="row-title">After updating the code</span>
              <span className="muted">
                Run <code>npm run setup:hari</code> once to rebuild for
                production.
              </span>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Data and privacy">
        <Card>
          {FACTS.map((fact) => (
            <div key={fact.label} className="setting-row">
              <div className="setting-text">
                <span className="row-title">{fact.label}</span>
                <span className="muted">{fact.note}</span>
              </div>
              <span className="meta">{fact.value}</span>
            </div>
          ))}
        </Card>

        <Card>
          <div className="setting-text">
            <span className="row-title">Private entries and diary notes</span>
            <span className="muted">
              Each is read in exactly one place: the private log on the Habits
              page, and the diary note on the Diary page. Nothing counts them,
              scores them, or carries them onto the Dashboard — and a lint rule
              fails the build if any other page tries to read either one.
            </span>
          </div>
        </Card>
      </Section>
    </div>
  );
}

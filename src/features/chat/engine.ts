/**
 * The chat command engine: one sentence in, one trusted result out.
 *
 * This is the only module that connects a language model to command execution, and it exists
 * as a separate file precisely so that connection is one visible seam rather than something
 * spread across routes and components.
 *
 * ## The path, and where the trust changes
 *
 * ```
 * sentence
 *   -> parser.parse()        the model proposes facts           (untrusted)
 *   -> interpret()           allowlist; anything else is refused (still untrusted)
 *   -> runCommand()          the Phase 1 validator, inside the executor (THE GATE)
 *   -> domain -> repositories -> SQLite
 *   -> describeApplied()     a sentence built from the stored result (trusted)
 * ```
 *
 * The model is on one side of the gate and the database is on the other, and nothing in this
 * file lets a value cross in the wrong direction. The candidate handed to `runCommand` is
 * still an unvalidated plain object; `runCommand` passes it to the executor, which re-validates
 * with the same `parseCommand` the structured form path uses. **There is one validator, called
 * once, in the one place Phase 1 put it.** This engine deliberately does not pre-validate, so
 * there is no second gate that could disagree with the first.
 *
 * ## What a refusal guarantees
 *
 * Every branch that does not reach the executor returns before anything is written, and every
 * branch that reaches it reports what the executor actually decided. A model failure, a
 * malformed proposal, an ambiguous sentence, a domain refusal, and a rejected write all return
 * without mutating state, which is the property the tests assert by comparing the database
 * before and after.
 *
 * Server-only: it reaches the database through the Phase 1 runtime.
 */
import "server-only";

import type { CommandKind } from "@/commands/contract";
import { interpret, type NaturalLanguageParser } from "@/commands/parser";
import { fieldForError, tokenForError } from "@/features/shared/outcomes";
import type { ChatResult } from "@/features/chat/presentation";
import { describeApplied } from "@/features/chat/presentation";

import { runCommand } from "@/features/shared/command-runtime";

/**
 * The engine, with its parser injected.
 *
 * Injecting the parser is what lets the failure paths be tested without a network, and what
 * keeps OpenRouter out of this file. A real request supplies a configured OpenRouter parser; a
 * test supplies a fixture.
 */
export type ChatEngine = {
  readonly interpret: (text: string) => Promise<ChatResult>;
};

/**
 * Runs a candidate and turns the outcome into something to display.
 *
 * Split out so the success and failure branches of execution are one place, and so the only
 * call to `runCommand` in the chat path is visible at a glance. The confirmation is built
 * from the executor's stored result; the failure is the executor's real error.
 */
function applyCandidate(
  kind: CommandKind,
  candidate: Record<string, unknown>,
): ChatResult {
  const result = runCommand(candidate);

  if (!result.ok) {
    return {
      status: "rejected",
      token: tokenForError(result.error),
      field: fieldForError(result.error),
    };
  }

  return {
    status: "applied",
    kind,
    message: describeApplied(kind, result.value),
  };
}

/**
 * Builds an engine around a parser.
 *
 * The sentence is passed to the model verbatim apart from the empty check. Trimming it first
 * would silently change what the user asked for, and the sentence is stored as
 * `source_text` so the change can be traced back later.
 */
export function createChatEngine(parser: NaturalLanguageParser): ChatEngine {
  return {
    async interpret(text: string): Promise<ChatResult> {
      if (text.trim() === "") {
        return { status: "empty" };
      }

      const proposed = await parser.parse(text);

      if (!proposed.ok) {
        return { status: proposed.error.kind, message: proposed.error.message };
      }

      // One switch, so the three non-executable outcomes return before the executor is
      // reached and the command case is narrowed by the type system rather than by a helper
      // whose return value TypeScript cannot follow.
      const interpretation = interpret(proposed.value, text);

      switch (interpretation.kind) {
        case "clarification":
          return {
            status: "needs_clarification",
            missing: interpretation.missing,
          };

        case "unsupported":
          return { status: "unsupported" };

        case "unreadable":
          return { status: "unreadable" };

        case "command":
          // The candidate is unvalidated on purpose. `runCommand` hands it to the executor,
          // which validates it with the same gate the structured path uses.
          return applyCandidate(
            interpretation.commandKind,
            interpretation.command,
          );
      }
    },
  };
}

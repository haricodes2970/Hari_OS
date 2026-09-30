/**
 * The composition root: the one place where execution is actually wired together.
 *
 * Micro-phase 1.4 built the executor and deliberately left it unwired, so that it could stay
 * deterministic and testable. This is where the real world is supplied:
 *
 * - the database handle, via the shared connection;
 * - the repositories, over that handle;
 * - the clock, which is the *only* place in the application that reads the time.
 *
 * Everything below this file takes its facts as arguments. That is why `executeCommand` can
 * be tested to the millisecond while this module cannot be tested at all — and that is the
 * correct division, because this module is the part that is allowed to know about the real
 * machine.
 *
 * Server-only. A Client Component importing this fails the build rather than quietly pulling
 * a database connection into the browser.
 */
import "server-only";

import { executeCommand, type ExecutionResult } from "@/commands/executor";
import { closeDb, getDb } from "@/lib/db/connection";
import { createRepositories, type Repositories } from "@/lib/db/repositories";

/**
 * The real execution clock.
 *
 * Read here and nowhere else in the application. The browser never supplies a timestamp: a
 * client that could set the time of its own expense entries could backdate a spend or
 * postdate one, so the value has to come from the server that actually stored the row.
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Repositories over the shared connection.
 *
 * Built per call rather than cached in a module variable so that there is exactly one source
 * of truth for the connection. The database handle itself is already cached by `getDb`, and
 * these repositories are a thin closure over it, so nothing is re-opened.
 */
export function getRepositories(): Repositories {
  return createRepositories(getDb());
}

/**
 * Runs an untrusted command object through the whole pipeline.
 *
 * Accepts `unknown` because this is the boundary where a form submission, and eventually a
 * model response, first becomes structured input. The executor re-validates, so a caller
 * cannot skip validation by calling the wrong thing.
 *
 * Returns the executor's result unchanged, so the caller can tell a validation problem from
 * a domain problem from a storage problem. The domain, the repositories, and the command
 * contract are all left exactly as they were.
 */
export function runCommand(untrusted: unknown): ExecutionResult {
  return executeCommand(untrusted, { repositories: getRepositories(), now });
}

/**
 * Closes the shared connection.
 *
 * Exists for scripts and tests that import this module and then need the file handle
 * released — on Windows an open handle would prevent the temporary directory being removed.
 * Request handling never calls it.
 */
export function releaseDatabase(): void {
  closeDb();
}

/**
 * The current UTC calendar date, as `YYYY-MM-DD`.
 *
 * UTC on purpose. Every timestamp in the schema is an ISO-8601 UTC instant, so filtering
 * "today's spend" by a local calendar date would silently disagree with what was stored
 * whenever the machine is not on UTC. One timezone, used consistently, beats the more
 * intuitive one that is wrong by a few hours a day.
 */
export function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Server runtime for the chat engine: environment in, a ready engine out.
 *
 * The seam where configuration, the OpenRouter provider, and the engine meet. Nothing else in
 * the application reads a credential, imports the provider, or constructs a parser.
 *
 * ## No fake parser, ever
 *
 * When configuration is missing, the engine is built around `unconfiguredParser`, which
 * returns a configuration failure as an ordinary result. It is tempting to fall back to
 * something that answers anyway, and that would be the worst possible choice: a stub that
 * invents an interpretation is indistinguishable from a working parser until the day it puts a
 * wrong number in the database. A user who cannot parse is told so.
 *
 * ## What is logged
 *
 * One line, once per process, describing the model and endpoint. `describeProviderConfig`
 * cannot include the key, so a diagnostic cannot leak it. The user's sentence is not logged.
 *
 * Server-only.
 */
import "server-only";

import { unconfiguredParser } from "@/commands/parser";

import { readProviderConfig, describeProviderConfig } from "./config.ts";
import { createChatEngine, type ChatEngine } from "./engine.ts";
import { createOpenRouterParser } from "./openrouter.ts";

/**
 * Cached per process.
 *
 * Config is read once because a Next.js server process keeps its environment fixed, and
 * re-reading it per request would suggest it could change. A missing key therefore needs a
 * restart to fix, which is what the configuration message says.
 */
let engine: ChatEngine | null = null;
let logged = false;

export function getChatEngine(): ChatEngine {
  if (engine !== null) {
    return engine;
  }

  const configuration = readProviderConfig();

  if (!configuration.ok) {
    engine = createChatEngine(unconfiguredParser(configuration.message));
    return engine;
  }

  if (!logged) {
    // The description cannot contain the key, by construction.
    console.info(
      `hari-os parser ready: ${describeProviderConfig(configuration.config)}`,
    );
    logged = true;
  }

  engine = createChatEngine(createOpenRouterParser(configuration.config));

  return engine;
}

/**
 * Whether the parser is configured, and why not if it is not.
 *
 * Read once per call so a page asks one question and gets one answer. The reason is the same
 * message the engine would return, so what the page says before a sentence is typed is exactly
 * what a submission would say — the user is not told one thing and then another.
 *
 * The message names a variable and a fix. It never contains a value from the environment, so
 * it is safe to render.
 */
export function parserAvailability(): {
  available: boolean;
  reason: string | null;
} {
  const configuration = readProviderConfig();

  return configuration.ok
    ? { available: true, reason: null }
    : { available: false, reason: configuration.message };
}

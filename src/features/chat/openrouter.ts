/**
 * The OpenRouter provider: one implementation of the parser port.
 *
 * This is the only module that makes a network request to a language model, and the only place
 * the credential travels. Everything above it — the engine, the parser, the domain — works in
 * terms of `NaturalLanguageParser` and never learns which provider answered.
 *
 * ## What comes back is text, and the text is not trusted
 *
 * `parse` returns `unknown` even on success. The provider is asked for JSON with a strict
 * response schema, and the model usually complies, but "usually" is not a guarantee a database
 * should be built on. So the response body is unwrapped, the assistant message's content is
 * taken as a **string**, and that string is `JSON.parse`d into an `unknown` that goes straight
 * to `interpret()`. There is no repair step, no retry, and no "close enough" parsing: a response
 * that is prose, a fenced block, `null`, or a truncated object fails here and is reported as
 * unreadable, because a second attempt at understanding the model would be a second, weaker
 * version of the interpretation logic the trust model depends on not existing.
 *
 * ## Failures are values, not exceptions
 *
 * A provider outage, a timeout, a 401, and a 429 are all ordinary outcomes for a network
 * client. Throwing would turn a temporary problem into a 500 and lose the distinction between
 * "the service is unavailable" and "I did not understand you", which are different problems for
 * the user and different things to look at when diagnosing. Each returns a `ParserFailure`
 * whose `kind` is `unconfigured`, `unavailable`, or `unreadable`.
 *
 * ## What is never logged
 *
 * Neither the API key nor the user's sentence. The key appears in exactly one place, the
 * `Authorization` header, and the sentence is sent in exactly one place, the user message. A
 * diagnostic reports the status code and the provider's own error text when it is safe to
 * repeat, never the request. The user's log is their own data, and the key is a secret; a log
 * line is the one place either would inevitably end up being copied into somewhere else.
 *
 * Server-only.
 */
import "server-only";

import {
  PARSER_INSTRUCTIONS,
  PARSER_RESPONSE_SCHEMA,
} from "@/commands/parser-prompt";
import type { NaturalLanguageParser, ParserResult } from "@/commands/parser";

import type { ProviderConfig } from "./config.ts";

/** The name OpenRouter shows for this schema in its request logs. */
const SCHEMA_NAME = "hari_os_command";

/**
 * OpenRouter's OpenAI-compatible endpoint.
 *
 * A fixed path on a configurable base URL, so a self-hosted or proxied OpenRouter works by
 * changing `OPENROUTER_BASE_URL` alone.
 */
function completionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Attribution headers, when configured.
 *
 * OpenRouter uses these to rank applications on its dashboard. They are optional, and sending
 * an empty value would be worse than omitting the header, so each is added only when present.
 */
function attributionHeaders(config: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {};

  if (config.appUrl !== null) {
    headers["HTTP-Referer"] = config.appUrl;
  }

  if (config.appTitle !== null) {
    headers["X-Title"] = config.appTitle;
  }

  return headers;
}

/** The shape of the part of the OpenRouter response this module reads. */
type CompletionResponse = {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: unknown };
  }>;
};

/**
 * Pulls the assistant's text out of a completion response.
 *
 * Returns `undefined` when the envelope is not the expected shape, which the caller turns into
 * `unreadable`. The content is checked for being a string rather than assumed: a provider that
 * answers with an array of content parts, or `null`, is a real possibility, and passing either
 * to `JSON.parse` would be a type error at best.
 */
function assistantContent(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const choice = (payload as CompletionResponse).choices?.[0];
  const content = choice?.message?.content;

  return typeof content === "string" && content.trim() !== ""
    ? content
    : undefined;
}

function unavailable(message: string): ParserResult {
  return { ok: false, error: { kind: "unavailable", message } };
}

/**
 * A transport, narrowed to the part of `fetch` this module uses.
 *
 * Declared rather than reusing `typeof fetch` so a test can supply a plain async function that
 * records its arguments, which is how the request this module builds is asserted rather than
 * assumed. Defaulting it to the global `fetch` leaves the production call site unchanged.
 */
type Transport = (
  url: string,
  init: {
    method: string;
    signal: AbortSignal;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/**
 * Builds the parser.
 *
 * Takes the already-validated configuration rather than reading the environment, so
 * `config.ts` stays the only module that does, and takes the transport as an optional second
 * argument so a test needs neither a network nor a key.
 */
export function createOpenRouterParser(
  config: ProviderConfig,
  transport: Transport = fetch as unknown as Transport,
): NaturalLanguageParser {
  return {
    parse: async (text: string): Promise<ParserResult> => {
      // One controller for the whole exchange. A parse that is slower than the configured
      // ceiling is abandoned rather than left holding the request open, which is what turns a
      // slow provider into a hung page.
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);

      let response: Awaited<ReturnType<Transport>>;

      try {
        response = await transport(completionsUrl(config.baseUrl), {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
            ...attributionHeaders(config),
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            messages: [
              { role: "system", content: PARSER_INSTRUCTIONS },
              { role: "user", content: text },
            ],
            // A strict schema is the strongest thing available to keep the answer in shape. It
            // is not relied upon: everything it produces still passes through `interpret`.
            response_format: {
              type: "json_schema",
              json_schema: {
                name: SCHEMA_NAME,
                strict: true,
                schema: PARSER_RESPONSE_SCHEMA,
              },
            },
          }),
        });
      } catch {
        // Whether the exchange ended because the ceiling was reached is decided by this
        // module's own controller, not by the shape of the error a transport happens to throw.
        // `fetch` rejects an aborted request with an `AbortError`, but that is one transport's
        // detail, and keying off it would report every timeout as a generic outage whenever
        // anything else interrupted the call.
        if (timedOut) {
          return unavailable(
            `The parser did not answer within ${config.timeoutMs}ms.`,
          );
        }

        return unavailable("Could not reach the parser service.");
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        // The status code is the useful diagnostic. The provider's body is not echoed, because
        // some providers include request fragments in their error payloads and this module has
        // no way to know what a given body contains.
        //
        // A rate limit is called out separately because the fix differs: waiting is correct,
        // whereas a generic outage is worth reporting as a problem.
        if (response.status === 429) {
          return unavailable(
            "The parser service is rate limiting this application. Wait a moment and try again.",
          );
        }

        return unavailable(
          `The parser service responded with ${response.status}.`,
        );
      }

      let payload: unknown;

      try {
        // Read as text and parse here rather than calling `response.json()`. Same result, and it
        // keeps two different failures apart: a body that is not JSON at all, and a JSON
        // document that is not the expected envelope.
        payload = JSON.parse(await response.text()) as unknown;
      } catch {
        return {
          ok: false,
          error: { kind: "unreadable", message: "unreadable" },
        };
      }

      const content = assistantContent(payload);

      if (content === undefined) {
        return {
          ok: false,
          error: { kind: "unreadable", message: "unreadable" },
        };
      }

      // The content is offered to `interpret` as a parsed value when it is JSON, and as the
      // raw string when it is not.
      //
      // Returning the string rather than failing here is deliberate. The transport did its job:
      // OpenRouter answered, with a well-formed envelope, containing something that is not a
      // proposal. Whether that is executable is `interpret`'s question and not this module's,
      // and duplicating the decision would mean two places that have to agree about what a
      // proposal is. A string is not a plain object, so `interpret` refuses it as unreadable on
      // its own.
      let value: unknown;

      try {
        value = JSON.parse(content) as unknown;
      } catch {
        value = content;
      }

      return { ok: true, value };
    },
  };
}

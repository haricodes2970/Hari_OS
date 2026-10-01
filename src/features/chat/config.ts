/**
 * Provider configuration, read from the environment on the server.
 *
 * The only module in the application that reads an LLM credential. Keeping it here means the
 * secret has one reader, and a reader that is `server-only` and therefore unreachable from a
 * client bundle.
 *
 * ## Nothing is defaulted that could hide a mistake
 *
 * `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are both **required**. A missing key is obvious
 * and can be reported, but a missing model is not, and inventing a model identifier would mean
 * shipping a default that is either wrong — every parse fails against an unknown model — or
 * right by accident, in which case nobody ever learns it was hard-coded. Requiring both means
 * the application either works or says precisely what is missing.
 *
 * In particular there is no fallback parser and no fake one. An unconfigured install reports a
 * configuration error through the normal result path, which is the same path a provider outage
 * uses, so there is no way for a broken install to look like a working one.
 *
 * Secrets are read into a local variable and passed to the request. They are never logged,
 * never included in an error message, and never returned in a response body — see
 * `openrouter.ts`, which is where the credential actually travels.
 *
 * Server-only.
 */
import "server-only";

/** Where OpenRouter exposes its OpenAI-compatible surface. */
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * A ceiling on how long a parse may take.
 *
 * Bounded on purpose. Without it a stalled provider would hold a request open until the
 * platform's own timeout, which turns one slow call into a hung page. Twenty seconds is
 * longer than a normal completion and short enough that a user gets an answer either way.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

export type ProviderConfig = {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Optional attribution, which OpenRouter uses for its dashboard rankings. */
  readonly appUrl: string | null;
  readonly appTitle: string | null;
};

/**
 * Reads the environment, or explains what is missing.
 *
 * Returns a discriminated union rather than throwing, because a missing key is an ordinary
 * configuration state the application reports, not a crash. Nothing here logs.
 */
export function readProviderConfig(
  environment: NodeJS.ProcessEnv = process.env,
):
  | { readonly ok: true; readonly config: ProviderConfig }
  | { readonly ok: false; readonly message: string } {
  const apiKey = environment.OPENROUTER_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") {
    return {
      ok: false,
      message:
        "OPENROUTER_API_KEY is not set. Copy .env.example to .env.local and add your key, then restart the server.",
    };
  }

  const model = environment.OPENROUTER_MODEL?.trim();
  if (model === undefined || model === "") {
    return {
      ok: false,
      message:
        "OPENROUTER_MODEL is not set. Set it to the model id you want to use, for example the one named in .env.example.",
    };
  }

  const timeout = Number(environment.OPENROUTER_TIMEOUT_MS);

  return {
    ok: true,
    config: {
      apiKey,
      model,
      baseUrl: environment.OPENROUTER_BASE_URL?.trim() ?? DEFAULT_BASE_URL,
      // A non-numeric or nonsensical value falls back to the default rather than producing
      // `NaN`, which would abort every request immediately and look like a provider outage.
      timeoutMs:
        Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
      appUrl: environment.OPENROUTER_APP_URL?.trim() ?? null,
      appTitle: environment.OPENROUTER_APP_TITLE?.trim() ?? null,
    },
  };
}

/**
 * A one-line description of the active configuration, safe to log.
 *
 * Deliberately returns the model and endpoint and nothing else. There is no code path here
 * that can include the API key, so a diagnostic cannot leak it.
 */
export function describeProviderConfig(config: ProviderConfig): string {
  return `model=${config.model} endpoint=${config.baseUrl} timeout=${config.timeoutMs}ms key=present`;
}

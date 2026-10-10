import type { SearchProvider, SearchResult } from "./providers.ts";

export type ProviderOutcome = {
  provider: string;
  status: "skipped" | "ok" | "empty" | "error" | "timeout";
  durationMs: number;
  resultCount: number;
  error?: string;
};

export type SearchSummary = {
  results: SearchResult[];
  providers: string[];
  outcomes: ProviderOutcome[];
};

const DEFAULT_TIMEOUT_MS = 6_000;
const TITLE_LIMIT = 200;
const SNIPPET_LIMIT = 500;
const URL_LIMIT = 1_000;
const SOURCE_LIMIT = 120;
const PUBLISHED_LIMIT = 80;
const ERROR_LIMIT = 300;
const TRACKING_KEYS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid"]);

function clampText(value: string | undefined, max: number): string | undefined {
  if (!value) return value;
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || TRACKING_KEYS.has(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value.trim();
  }
}

function boundedResult(result: SearchResult): SearchResult {
  return {
    ...result,
    title: clampText(result.title, TITLE_LIMIT) ?? "Untitled",
    snippet: clampText(result.snippet, SNIPPET_LIMIT),
    source: clampText(result.source, SOURCE_LIMIT),
    published: clampText(result.published, PUBLISHED_LIMIT),
  };
}

export function dedupe(results: SearchResult[], max: number): SearchResult[] {
  const seen = new Set<string>();
  const output: SearchResult[] = [];
  for (const result of results) {
    const key = canonicalUrl(result.url);
    if (!/^https?:\/\//i.test(key) || key.length > URL_LIMIT || seen.has(key)) continue;
    seen.add(key);
    output.push(boundedResult({ ...result, url: key }));
    if (output.length >= max) break;
  }
  return output;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return clampText(text, ERROR_LIMIT) ?? "Unknown provider error";
}

function skippedOutcome(provider: string): ProviderOutcome {
  return { provider, status: "skipped", durationMs: 0, resultCount: 0 };
}

async function runProvider(provider: SearchProvider, outer: AbortSignal | undefined, timeoutMs: number) {
  if (!provider.configured) return { results: [], outcome: skippedOutcome(provider.name) };
  const started = Date.now();
  const timeout = AbortSignal.timeout(provider.timeoutMs ?? timeoutMs);
  const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;
  try {
    const results = await provider.run(signal);
    const status = results.length ? "ok" : "empty";
    return { results, outcome: { provider: provider.name, status, durationMs: Date.now() - started, resultCount: results.length } as ProviderOutcome };
  } catch (error) {
    if (outer?.aborted) throw outer.reason ?? error;
    const status = timeout.aborted ? "timeout" : "error";
    return { results: [], outcome: { provider: provider.name, status, durationMs: Date.now() - started, resultCount: 0, error: errorText(error) } as ProviderOutcome };
  }
}

function failureMessage(outcomes: ProviderOutcome[]): string {
  const notes = outcomes.filter((item) => item.status !== "skipped")
    .map((item) => `${item.provider}: ${item.status}${item.error ? ` (${item.error})` : ""}`);
  const configured = outcomes.some((item) => item.status !== "skipped");
  const setup = configured ? "" : " Install and log in to Codex CLI, or configure BRAVE_SEARCH_API_KEY or TAVILY_API_KEY.";
  return `No search provider returned results.${setup} ${notes.join("; ")}`.trim();
}

export async function searchProviders(
  providers: SearchProvider[],
  max: number,
  outer?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SearchSummary> {
  const collected: SearchResult[] = [];
  const outcomes: ProviderOutcome[] = [];
  const used: string[] = [];
  for (const provider of providers) {
    const { results, outcome } = await runProvider(provider, outer, timeoutMs);
    outcomes.push(outcome);
    if (results.length) used.push(provider.name);
    collected.push(...results);
    const merged = dedupe(collected, max);
    if (merged.length >= max) return { results: merged, providers: used, outcomes };
  }
  const results = dedupe(collected, max);
  if (!results.length) throw new Error(failureMessage(outcomes));
  return { results, providers: used, outcomes };
}

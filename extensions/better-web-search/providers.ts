import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codexAvailable, createCodexProvider } from "./codex.ts";

export type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  published?: string;
};

export type SearchProvider = {
  name: string;
  configured: boolean;
  timeoutMs?: number;
  run: (signal: AbortSignal) => Promise<SearchResult[]>;
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 pi-better-web-search/2.0";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function zedTavilyKey(): string | undefined {
  const home = homedir();
  const paths = [
    join(home, ".config/zed/settings.json"),
    join(home, ".config/zed/settings_backup.json"),
    join(home, "Library/Application Support/Zed/settings.json"),
  ];
  for (const path of paths) {
    try {
      const text = readFileSync(path, "utf8");
      const match = text.match(/"(?:tavily_api_key|TAVILY_API_KEY)"\s*:\s*"([^"]+)"/i);
      if (match?.[1] && !/^YOUR[_-]?TAVILY/i.test(match[1])) return match[1].trim();
    } catch { /* Optional config file. */ }
  }
}

function tavilyKey(): string | undefined {
  return env("TAVILY_API_KEY") ?? zedTavilyKey();
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(parseInt(value, 10)));
}

function stripTags(html: string): string {
  return decodeHtml(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function hostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

async function fetchJson<T>(url: string, init: RequestInit, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { ...init, signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return await response.json() as T;
}

async function braveSearch(key: string, query: string, max: number, signal: AbortSignal) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(max, 20)));
  url.searchParams.set("text_decorations", "false");
  url.searchParams.set("spellcheck", "true");
  const headers = { Accept: "application/json", "X-Subscription-Token": key, "User-Agent": USER_AGENT };
  const data = await fetchJson<any>(url.toString(), { headers }, signal);
  return (data.web?.results ?? []).map((item: any) => ({
    title: stripTags(String(item.title ?? "Untitled")),
    url: String(item.url ?? ""),
    snippet: stripTags(String(item.description ?? "")),
    source: item.profile?.name ?? hostname(String(item.url ?? "")),
    published: item.age,
  }));
}

async function tavilySearch(key: string, query: string, max: number, signal: AbortSignal) {
  const body = { api_key: key, query, search_depth: "fast", max_results: max, include_answer: false };
  const data = await fetchJson<any>("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
  }, signal);
  return (data.results ?? []).map((item: any) => ({
    title: String(item.title ?? "Untitled"),
    url: String(item.url ?? ""),
    snippet: stripTags(String(item.content ?? "")),
    source: hostname(String(item.url ?? "")),
    published: item.published_date,
  }));
}

export function createProviders(query: string, max: number): SearchProvider[] {
  const braveKey = env("BRAVE_SEARCH_API_KEY");
  const tavily = tavilyKey();
  return [
    { name: "Brave", configured: Boolean(braveKey), run: (signal) => braveSearch(braveKey!, query, max, signal) },
    { name: "Tavily", configured: Boolean(tavily), run: (signal) => tavilySearch(tavily!, query, max, signal) },
    createCodexProvider(query, max),
  ];
}

export function configuredProviderNames(): string[] {
  return [env("BRAVE_SEARCH_API_KEY") ? "Brave" : undefined, tavilyKey() ? "Tavily" : undefined,
    codexAvailable() ? "Codex (ChatGPT)" : undefined].filter((name): name is string => Boolean(name));
}

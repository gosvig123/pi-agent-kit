import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { configuredProviderNames, createProviders, type SearchResult } from "./providers.ts";
import { searchProviders } from "./search.ts";

const QUERY_DISPLAY_LIMIT = 500;
const SEARCH_GUIDELINES = [
  "Use better_web_search when current, external, or source-backed information would improve the answer.",
  "After better_web_search, verify important claims by fetching the strongest primary sources with web_fetch.",
];
const SEARCH_PARAMETERS = Type.Object({
  query: Type.String({ description: "Precise search query with relevant terms, dates, and site filters." }),
  maxResults: Type.Optional(Type.Number({ description: "Number of results, 1-20. Defaults to 8." })),
});

function formatResults(results: SearchResult[]): string {
  return results.map((result, index) => {
    const lines = [`${index + 1}. ${result.title}`, `   URL: ${result.url}`];
    if (result.source) lines.push(`   Source: ${result.source}`);
    if (result.published) lines.push(`   Published: ${result.published}`);
    if (result.snippet) lines.push(`   Snippet: ${result.snippet}`);
    return lines.join("\n");
  }).join("\n\n");
}

function providerLabel(names: string[]): string {
  return names.length ? names.join(" → ") : "none";
}

export function displayQuery(query: string): string {
  return query.length <= QUERY_DISPLAY_LIMIT ? query : `${query.slice(0, QUERY_DISPLAY_LIMIT - 1)}…`;
}

function registerSearchTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "better_web_search",
    label: "Better Web Search",
    description: "Search the live web with bounded provider fallbacks and explicit failure reporting.",
    promptSnippet: "Search through Brave or Tavily when configured, with a ChatGPT-backed Codex fallback.",
    promptGuidelines: SEARCH_GUIDELINES,
    parameters: SEARCH_PARAMETERS,
    async execute(_toolCallId, params, signal) {
      const max = Math.max(1, Math.min(20, Math.floor(params.maxResults ?? 8)));
      const summary = await searchProviders(createProviders(params.query, max), max, signal);
      const query = displayQuery(params.query);
      const text = [`Query: ${query}`, `Provider: ${providerLabel(summary.providers)}`, "", formatResults(summary.results)].join("\n");
      return { content: [{ type: "text", text }], details: { query, ...summary } };
    },
  });
}

function registerInfoCommand(pi: ExtensionAPI) {
  pi.registerCommand("web-search-info", {
    description: "Show better web search provider configuration",
    handler: async (_args, ctx) => {
      const names = configuredProviderNames();
      const configured = names.length ? names.join(", ") : "no provider";
      ctx.ui.notify(`Better web search: ${configured}`, "info");
    },
  });
}

export default function betterWebSearch(pi: ExtensionAPI) {
  registerSearchTool(pi);
  registerInfoCommand(pi);
}

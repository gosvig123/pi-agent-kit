import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WEB_FETCH_TOOL = "web_fetch";
const BATCH_FETCH_TOOL = "batch_web_fetch";

function isDirectFailure(details: unknown): boolean {
  return details !== null && typeof details === "object" && "error" in details && details.error === true;
}

function isCompleteBatchFailure(details: unknown): boolean {
  if (!details || typeof details !== "object") return false;
  const batch = (details as { batchResult?: { total?: number; failed?: number } }).batchResult;
  return Boolean(batch?.total && batch.failed === batch.total);
}

export default function fetchErrorNormalizer(pi: ExtensionAPI) {
  pi.on("tool_result", (event) => {
    if (event.toolName === WEB_FETCH_TOOL && isDirectFailure(event.details)) {
      return { isError: true };
    }
    if (event.toolName === BATCH_FETCH_TOOL && isCompleteBatchFailure(event.details)) {
      return { isError: true };
    }
  });
}

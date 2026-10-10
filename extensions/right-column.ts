import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { rightOverlayStack } from "../lib/right-overlay-stack";

// Loads the shared right column that other extensions (pi-desk task panel) register into.
export default function (pi: ExtensionAPI) {
  rightOverlayStack.hideDuringDialogs(pi);
}

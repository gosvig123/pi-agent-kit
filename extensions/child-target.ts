import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	DELEGATE_TOOLS,
	checkReviewModelDiversity,
	defaultChildTarget,
	needsDefaultChildTarget,
	pickReviewTarget,
	type DelegateInput,
} from "../lib/guards/delegate.ts";

export { DELEGATE_TOOLS };

// Sets deterministic child targets on delegate_task:
// - For role === "review": rotates across the models in {sol 6.2, opus 5.5, neon} that differ from
//   the orchestrator's current model (ctx.model), and blocks same-model review targets once.
// - For all other roles: defaults to GPT-6.2 Sol (high) via Pi when target is omitted.
export default function childTarget(pi: ExtensionAPI) {
	let reviewIndex = 0;
	const warned = new Set<string>();

	pi.on("tool_call", (event, ctx) => {
		if (!DELEGATE_TOOLS.has(event.toolName)) return;
		const input = event.input as DelegateInput;
		const parentModel = ctx.model ? `${ctx.model.provider ?? ""}/${ctx.model.id ?? ""}` : undefined;

		if (input.role === "review") {
			if (needsDefaultChildTarget(input)) {
				const picked = pickReviewTarget(parentModel, reviewIndex++);
				input.target = picked.target;
				return;
			}
			const sameModel = checkReviewModelDiversity(input, parentModel);
			if (sameModel) {
				const key = JSON.stringify({ role: input.role, target: input.target, task: input.task });
				if (warned.has(key)) return;
				warned.add(key);
				return {
					block: true,
					reason: `${sameModel} If the user explicitly requested the same model, call delegate_task again with the same input.`,
				};
			}
			return;
		}

		if (needsDefaultChildTarget(input)) input.target = defaultChildTarget();
	});
}

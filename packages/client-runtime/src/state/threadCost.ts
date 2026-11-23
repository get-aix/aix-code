import { ORCHESTRATION_V2_WS_METHODS, type ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { Atom } from "effect/reactivity";

import type { EnvironmentThreadStructure } from "./models.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** A thread's cost, refetched when its settled turns or subagents change. */
export function createThreadCostReadAtomFamily<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
  options: {
    readonly quietThreadAtom: (
      ref: ScopedThreadRef,
    ) => Atom.Atom<EnvironmentThreadStructure | null>;
  },
) {
  return createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:orchestration:thread-cost",
    tag: ORCHESTRATION_V2_WS_METHODS.getThreadCost,
    staleTimeMs: 0,
    idleTtlMs: 0,
    refreshTrigger: ({ environmentId, input }) =>
      Atom.make((get) => {
        const thread = get(options.quietThreadAtom({ environmentId, threadId: input.threadId }));
        if (thread === null) return null;
        const { projection } = thread;
        // Settled turns only: streaming usage would refetch the whole subagent tree per tick.
        return JSON.stringify({
          turns: projection.providerTurns.flatMap((turn) =>
            turn.status === "pending" || turn.status === "running"
              ? []
              : [[turn.id, turn.status, turn.model, turn.turnTokenUsage]],
          ),
          subagents: projection.subagents.map((subagent) => [
            subagent.id,
            subagent.childThreadId,
            subagent.title,
            subagent.status,
          ]),
        });
      }),
  });
}

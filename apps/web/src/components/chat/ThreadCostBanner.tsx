import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { msg, useGT } from "gt-react";
import { CoinsIcon } from "lucide-react";

import { m, type MessageResolver } from "../../i18n/messages";
import { threadCostRead } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { CostRow } from "./ThreadDetailsCost";

/** `/cost`: this thread's cost and its subagents', read live until dismissed. */
export function threadCostBannerItem(
  input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly onDismiss: () => void;
  },
  resolve: MessageResolver = m,
): ComposerBannerStackItem {
  return {
    id: "thread-cost",
    variant: "info",
    icon: <CoinsIcon />,
    title: resolve(msg("Thread cost")),
    dismissLabel: resolve(msg("Dismiss thread cost")),
    onDismiss: input.onDismiss,
    children: (
      <ThreadCostBannerBody environmentId={input.environmentId} threadId={input.threadId} />
    ),
  };
}

function ThreadCostBannerBody({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const cost = useEnvironmentQuery(threadCostRead({ environmentId, input: { threadId } }));
  if (cost.data === null) {
    return (
      <p className="text-xs text-muted-foreground">
        {cost.isSuccess
          ? gt("Cost is not available for this thread.")
          : (cost.error ?? gt("Calculating cost…"))}
      </p>
    );
  }
  const summary = cost.data;
  return (
    <div className="space-y-0.5 text-xs">
      <CostRow label={gt("Total")} costUsd={summary.totalCostUsd} />
      <CostRow label={gt("Main thread")} costUsd={summary.mainThreadCostUsd} className="pl-4" />
      {summary.subagents.map((subagent) => (
        <CostRow
          key={subagent.threadId}
          label={subagent.title}
          costUsd={subagent.costUsd}
          className="pl-4"
        />
      ))}
    </div>
  );
}

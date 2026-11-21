import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadAllowedLanes } from "@t3tools/shared/modelLanes";
import type { EnvironmentId, OrchestrationV2TurnItem } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { modelLaneRequestEnvironment } from "../../state/modelLaneRequests";
import { useThreadShell } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { threadEnvironment } from "../../state/threads";
import { Button } from "../ui/button";
import { useEnvironmentProviders } from "../../state/environments";
import { aixProfileLabels, laneLabel } from "./modelLanes.logic";
import { WorkLogRow } from "./WorkLog";

type LaneRequestItem = Extract<OrchestrationV2TurnItem, { type: "lane_request" }>;

function useLaneLabel(environmentId: EnvironmentId, lane: string): string {
  const m = useMessages();
  return laneLabel(lane, aixProfileLabels(useEnvironmentProviders().get(environmentId) ?? []), m);
}

/** Inline card for an agent asking to run on a key outside its thread's lane. */
export function LaneRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: LaneRequestItem;
}) {
  if (props.item.laneStatus === "pending") {
    return <PendingLaneRequest environmentId={props.environmentId} item={props.item} />;
  }
  return <AnsweredLaneRequest environmentId={props.environmentId} item={props.item} />;
}

function PendingLaneRequest(props: {
  readonly environmentId: EnvironmentId;
  readonly item: LaneRequestItem;
}) {
  const { item } = props;
  const [busy, setBusy] = useState(false);
  const label = useLaneLabel(props.environmentId, item.lane);
  const gt = useGT();
  const answer = useAtomCommand(modelLaneRequestEnvironment.answer, {
    label: "answer lane request",
  });
  const canAnswer = useAtomValue(
    modelLaneRequestEnvironment.answer.permissionAtom(props.environmentId),
  );

  const send = async (type: "allow-task" | "allow-thread" | "deny") => {
    setBusy(true);
    await answer({
      environmentId: props.environmentId,
      input: { threadId: item.threadId, turnItemId: item.id, answer: { type } },
    }).finally(() => setBusy(false));
  };

  return (
    <div
      data-v2-item-type={item.type}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          {item.requestedFor === "task"
            ? gt("Run a subagent on {lane}?", { lane: label })
            : gt("Use {lane} in this thread?", { lane: label })}
        </p>
        <p className="text-sm text-muted-foreground">
          {item.providerLabel}: {item.reason}
        </p>
      </div>
      {canAnswer ? (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            disabled={busy}
            onClick={() => void send("deny")}
          >
            <T>Deny</T>
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => void send("allow-task")}
          >
            <T>Allow this task</T>
          </Button>
          <Button type="button" size="xs" disabled={busy} onClick={() => void send("allow-thread")}>
            <T>Allow for this thread</T>
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          <T>Only a session that can operate this environment can answer this.</T>
        </p>
      )}
    </div>
  );
}

function AnsweredLaneRequest(props: {
  readonly environmentId: EnvironmentId;
  readonly item: LaneRequestItem;
}) {
  const { item } = props;
  const thread = useThreadShell(scopeThreadRef(props.environmentId, item.threadId));
  const canAnswer = useAtomValue(
    modelLaneRequestEnvironment.answer.permissionAtom(props.environmentId),
  );
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata);
  const label = useLaneLabel(props.environmentId, item.lane);
  const gt = useGT();

  if (item.laneStatus === "allowed_thread") {
    const stillAllowed = thread ? threadAllowedLanes(thread).includes(item.lane) : true;
    const revoke = () => {
      if (!thread) return;
      void updateThreadMetadata({
        environmentId: props.environmentId,
        input: {
          threadId: thread.id,
          allowedLanes: threadAllowedLanes(thread).filter((lane) => lane !== item.lane),
        },
      });
    };
    return (
      <WorkLogRow
        data-v2-item-type={item.type}
        icon={<CheckIcon className="size-3.5 text-icon-muted" aria-hidden />}
        label={
          stillAllowed
            ? gt("Allowed {lane} for this thread", { lane: label })
            : gt("Revoked {lane} for this thread", { lane: label })
        }
        trailing={
          stillAllowed && canAnswer ? (
            <Button type="button" size="xs" variant="ghost-muted" onClick={revoke}>
              <T>Revoke</T>
            </Button>
          ) : null
        }
      />
    );
  }

  const status =
    item.laneStatus === "allowed_task"
      ? { icon: CheckIcon, label: gt("Allowed {lane} for this task", { lane: label }) }
      : item.laneStatus === "denied"
        ? { icon: XIcon, label: gt("Denied {lane}", { lane: label }) }
        : { icon: MinusIcon, label: gt("Cancelled request for {lane}", { lane: label }) };
  return (
    <WorkLogRow
      data-v2-item-type={item.type}
      icon={<status.icon className="size-3.5 text-icon-muted" aria-hidden />}
      label={status.label}
    />
  );
}

import type {
  ModelSelection,
  OrchestrationV2AppThread,
  OrchestrationV2InternalCommand,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  allowedLanesForProject,
  isLaneAllowed,
  laneOfInstance,
  laneOfInstanceOrId,
  type ModelLane,
  type ModelLaneInstance,
  type ModelLaneProject,
  threadAllowedLanes,
} from "@t3tools/shared/modelLanes";

export class ModelLaneNotAllowedError extends Schema.TaggedError<ModelLaneNotAllowedError>()(
  "ModelLaneNotAllowedError",
  { detail: Schema.String },
) {
  readonly code = "model_lane_not_allowed";

  override get message(): string {
    return this.detail;
  }
}

const isTaggedModelLaneNotAllowedError = Schema.is(ModelLaneNotAllowedError);

export function modelLaneNotAllowedError(
  error: unknown,
  seen: Set<object> = new Set(),
): Error | undefined {
  if (isTaggedModelLaneNotAllowedError(error)) return error;
  if (typeof error !== "object" || error === null || seen.has(error)) return undefined;
  seen.add(error);
  if (
    "_tag" in error &&
    error._tag === "ModelLaneNotAllowedError" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return new ModelLaneNotAllowedError({ detail: error.message });
  }
  return "cause" in error ? modelLaneNotAllowedError(error.cause, seen) : undefined;
}

export function isModelLaneNotAllowedError(error: unknown): boolean {
  return modelLaneNotAllowedError(error) !== undefined;
}

export function laneNotAllowedError(policy: {
  readonly lane: string;
  readonly allowedProviders: ReadonlyArray<string>;
}): ModelLaneNotAllowedError {
  return new ModelLaneNotAllowedError({
    detail: `Lane ${policy.lane} is not allowed for this thread. Allowed providers: ${policy.allowedProviders.join(", ") || "none"}. Call request_model_lane to ask the user.`,
  });
}

export function modelLanePolicy(input: {
  readonly thread: OrchestrationV2AppThread;
  readonly selection: ModelSelection;
  readonly project: ModelLaneProject | undefined;
  readonly providerInstances: Readonly<Record<string, ModelLaneInstance>>;
}) {
  const lane = laneOfInstanceOrId(
    input.selection.instanceId,
    input.providerInstances[input.selection.instanceId],
  );
  const project = input.project ?? { scope: "personal" as const };
  const threadLanes = threadAllowedLanes(input.thread);
  const allowedLanes = allowedLanesForProject(project, threadLanes);
  const allowedProviders = Object.entries(input.providerInstances)
    .filter(([, instance]) => allowedLanes.includes(laneOfInstance(instance)))
    .map(([instanceId]) => instanceId);
  return {
    lane,
    allowedLanes,
    allowedProviders,
    allowed: isLaneAllowed(project, threadLanes, lane),
  } satisfies {
    readonly lane: ModelLane;
    readonly allowedLanes: ReadonlyArray<string>;
    readonly allowedProviders: ReadonlyArray<string>;
    readonly allowed: boolean;
  };
}

export function findUnconsumedTaskLaneGrant(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  lane: string,
): Extract<OrchestrationV2TurnItem, { readonly type: "lane_request" }> | undefined {
  return items.find(
    (item): item is Extract<OrchestrationV2TurnItem, { readonly type: "lane_request" }> =>
      item.type === "lane_request" &&
      item.lane === lane &&
      item.laneStatus === "allowed_task" &&
      item.grantConsumedAt === undefined,
  );
}

export function consumedTaskLaneGrant(
  grant: Extract<OrchestrationV2TurnItem, { readonly type: "lane_request" }>,
  consumedAt: NonNullable<
    Extract<OrchestrationV2TurnItem, { readonly type: "lane_request" }>["grantConsumedAt"]
  >,
) {
  return { ...grant, grantConsumedAt: consumedAt, updatedAt: consumedAt };
}

type LaneRequestTurnItem = Extract<OrchestrationV2TurnItem, { type: "lane_request" }>;

function isTaskLaneGrantConsumption(
  item: OrchestrationV2TurnItem | undefined,
  consumedAt: unknown,
): item is Extract<OrchestrationV2TurnItem, { readonly type: "lane_request" }> {
  return (
    item?.type === "lane_request" &&
    item.laneStatus === "allowed_task" &&
    item.grantConsumedAt === undefined &&
    consumedAt !== undefined
  );
}

export type LaneRequestRecordDisposition =
  | { readonly kind: "unchanged" }
  | { readonly kind: "record" }
  | {
      readonly kind: "consume";
      readonly grant: LaneRequestTurnItem;
      readonly consumedAt: NonNullable<LaneRequestTurnItem["grantConsumedAt"]>;
    };

export function laneRequestRecordDisposition(
  existing: OrchestrationV2TurnItem | undefined,
  grantConsumedAt: LaneRequestTurnItem["grantConsumedAt"],
): LaneRequestRecordDisposition {
  if (
    existing?.type === "lane_request" &&
    isTaskLaneGrantConsumption(existing, grantConsumedAt) &&
    grantConsumedAt !== undefined
  ) {
    return { kind: "consume", grant: existing, consumedAt: grantConsumedAt };
  }
  if (existing?.type === "lane_request" && existing.laneStatus !== "pending") {
    return { kind: "unchanged" };
  }
  return { kind: "record" };
}

type LaneRequestRecordTurnItemBase = {
  readonly command: Extract<
    OrchestrationV2InternalCommand,
    { readonly type: "lane_request.record" }
  >;
  readonly providerThreadId: LaneRequestTurnItem["providerThreadId"];
  readonly providerTurnId: LaneRequestTurnItem["providerTurnId"];
  readonly now: OrchestrationV2TurnItem["updatedAt"];
};

type LaneRequestRecordTurnItemInput = LaneRequestRecordTurnItemBase &
  (
    | {
        readonly disposition: Extract<LaneRequestRecordDisposition, { kind: "consume" }>;
      }
    | {
        readonly disposition: Extract<LaneRequestRecordDisposition, { kind: "record" }>;
        readonly ordinal: number;
      }
  );

export function laneRequestRecordTurnItem(
  input: LaneRequestRecordTurnItemInput,
): OrchestrationV2TurnItem {
  if (!("ordinal" in input)) {
    const { disposition, now } = input;
    return { ...disposition.grant, grantConsumedAt: disposition.consumedAt, updatedAt: now };
  }
  const { command, providerThreadId, providerTurnId, now, ordinal } = input;
  const pending = command.laneStatus === "pending";
  const {
    type: _type,
    commandId: _commandId,
    turnItemId: _turnItemId,
    wake: _wake,
    ...fields
  } = command;
  return {
    ...fields,
    id: command.turnItemId,
    providerThreadId,
    providerTurnId,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: pending
      ? "waiting"
      : command.laneStatus === "allowed_task" || command.laneStatus === "allowed_thread"
        ? "completed"
        : "cancelled",
    title: `Request ${command.lane} provider access`,
    startedAt: now,
    completedAt: pending ? null : now,
    updatedAt: now,
    type: "lane_request",
  };
}

import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { formatUsd } from "@t3tools/shared/usageFormat";
import { useGT } from "gt-react-native";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { threadCostRead } from "../../state/threadCost";

/** `/cost`: this thread's cost and its subagents', read live until dismissed. */
export function ComposerThreadCost({
  environmentId,
  threadId,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const cost = useEnvironmentQuery(threadCostRead({ environmentId, input: { threadId } }));
  const summary = cost.data;
  return (
    <View className="overflow-hidden rounded-[20px] border-continuous bg-card">
      <View className="flex-row items-center justify-between gap-3 px-4 pt-3">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-semibold text-foreground">
          {gt("Thread cost")}
        </Text>
        <Pressable
          accessibilityLabel={gt("Dismiss thread cost")}
          accessibilityRole="button"
          hitSlop={12}
          onPress={onClose}
          className="-me-1 p-1 active:opacity-60"
        >
          <SymbolView
            name="xmark"
            size={14}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
          />
        </Pressable>
      </View>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ maxHeight: 240 }}>
        <View className="gap-1 px-4 pb-3 pt-2">
          {summary !== null && summary !== undefined ? (
            <>
              <CostLine label={gt("Total")} costUsd={summary.totalCostUsd} />
              <CostLine label={gt("Main thread")} costUsd={summary.mainThreadCostUsd} indent />
              {summary.subagents.map((subagent) => (
                <CostLine
                  key={subagent.threadId}
                  label={subagent.title}
                  costUsd={subagent.costUsd}
                  indent
                />
              ))}
            </>
          ) : (
            <Text className="text-xs text-foreground-muted">
              {cost.isSuccess
                ? gt("Cost is not available for this thread.")
                : (cost.error ?? gt("Calculating cost…"))}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function CostLine({
  label,
  costUsd,
  indent = false,
}: {
  readonly label: string;
  readonly costUsd: number;
  readonly indent?: boolean;
}) {
  return (
    <View className={`flex-row items-center justify-between gap-3 ${indent ? "pl-3" : ""}`}>
      <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-foreground-muted">
        {label}
      </Text>
      <Text className="text-xs tabular-nums text-foreground">{formatUsd(costUsd)}</Text>
    </View>
  );
}

import type { UsageScope } from "@t3tools/contracts";
import { T, useGT } from "gt-react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

export function UsageScopeControl({
  groups,
  scope,
  compact = false,
  onChange,
}: {
  readonly groups: ReadonlySet<UsageScope>;
  readonly scope: UsageScope;
  readonly compact?: boolean;
  readonly onChange: (scope: UsageScope) => void;
}) {
  const gt = useGT();
  if (groups.size < 2) return null;
  if (compact) {
    return (
      <div className="w-24">
        <Select
          value={scope}
          onValueChange={(value) => {
            if (value === "personal" || value === "work") onChange(value);
          }}
        >
          <SelectTrigger aria-label={gt("Usage scope")} size="compact" variant="ghost">
            <SelectValue>{scope === "work" ? gt("Work") : gt("Personal")}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="personal">
              <T>Personal</T>
            </SelectItem>
            <SelectItem value="work">
              <T>Work</T>
            </SelectItem>
          </SelectPopup>
        </Select>
      </div>
    );
  }
  return (
    <ToggleGroup
      aria-label={gt("Usage scope")}
      variant="segmented"
      value={[scope]}
      onValueChange={(next) => {
        const value = next[0];
        if (value === "personal" || value === "work") onChange(value);
      }}
    >
      <Toggle value="personal">
        <T>Personal</T>
      </Toggle>
      <Toggle value="work">
        <T>Work</T>
      </Toggle>
    </ToggleGroup>
  );
}

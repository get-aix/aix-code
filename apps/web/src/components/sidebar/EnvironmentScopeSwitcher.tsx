import { T, useGT } from "gt-react";

import { useClientEnvironmentScope, setActiveEnvironmentScope } from "../../environmentScope";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

export function EnvironmentScopeSwitcher() {
  const { activeScope } = useClientEnvironmentScope();
  const gt = useGT();

  return (
    <div className="flex min-w-0 items-center gap-1">
      <ToggleGroup
        aria-label={gt("Project scope")}
        className="min-w-0 flex-1 *:flex-1"
        value={[activeScope]}
        onValueChange={(value) => {
          const nextScope = value[0];
          if (nextScope === "work" || nextScope === "personal") {
            void setActiveEnvironmentScope(nextScope);
          }
        }}
      >
        <Toggle value="personal">
          <T>Personal</T>
        </Toggle>
        <Toggle value="work">
          <T>Work</T>
        </Toggle>
      </ToggleGroup>
    </div>
  );
}

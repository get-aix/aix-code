import { T, useGT } from "gt-react";
import { ChevronUpIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { composerFloatingLayerProps } from "./composerEventScope";
import { useModelPickerHierarchy } from "./ModelPickerHierarchyContext";

export function ModelPickerHierarchyFooterControls() {
  const hierarchy = useModelPickerHierarchy();
  const gt = useGT();
  if (!hierarchy || hierarchy.profiles.length === 0) return null;
  const selectedProfile = hierarchy.profiles.find((profile) => profile.id === hierarchy.profileId);
  return (
    <div className="flex min-w-0 items-center gap-2" data-model-picker-hierarchy-controls>
      <ToggleGroup
        aria-label={gt("Model scope")}
        variant="segmented"
        value={[hierarchy.scope]}
        onValueChange={(next) => {
          const scope = next[0];
          if (scope === "personal" || scope === "work") hierarchy.onScopeChange(scope);
        }}
      >
        <Toggle value="personal">
          <T>Personal</T>
        </Toggle>
        <Toggle value="work">
          <T>Work</T>
        </Toggle>
      </ToggleGroup>
      {hierarchy.scope === "work" ? (
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost-muted"
                size="xs"
                aria-label={gt("Work profile: {profile}", {
                  profile: selectedProfile?.label ?? gt("Choose profile"),
                })}
              />
            }
          >
            <span className="max-w-28 truncate">
              {selectedProfile?.label ?? gt("Choose profile")}
            </span>
            <ChevronUpIcon aria-hidden="true" className="size-3" />
          </MenuTrigger>
          <MenuPopup side="top" align="start" {...composerFloatingLayerProps}>
            <MenuRadioGroup
              aria-label={gt("Work profile")}
              value={hierarchy.profileId ?? ""}
              onValueChange={(value: string) => hierarchy.onProfileChange(value)}
            >
              {hierarchy.profiles.map((profile) => (
                <MenuRadioItem key={profile.id} value={profile.id} closeOnClick>
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate">{profile.label}</span>
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      ) : null}
    </div>
  );
}

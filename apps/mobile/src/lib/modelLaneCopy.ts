import type { ModelLane } from "@t3tools/contracts";
import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../i18n/messages";

type LaneProvider = {
  readonly aixProfile?: string | undefined;
  readonly aixProfileLabel?: string | undefined;
};

/** What a lane is called: "Personal", or the work key's name. */
export function laneKeyName(
  lane: ModelLane,
  providers: ReadonlyArray<LaneProvider>,
  resolve: MessageResolver = m,
): string {
  if (lane === "personal") return resolve(msg("Personal"));
  const profileId = lane.slice("aix:".length);
  return (
    providers.find((provider) => provider.aixProfile === profileId)?.aixProfileLabel ?? profileId
  );
}

/** A lane with its kind, as cards name it: "Personal" or "Work · <key>". */
export function laneTitle(
  lane: ModelLane,
  providers: ReadonlyArray<LaneProvider>,
  resolve: MessageResolver = m,
): string {
  const name = laneKeyName(lane, providers, resolve);
  return lane === "personal" ? name : resolve(msg("Work · {name}", { name }));
}

/** The send confirm: `homeName` is the project's home key, or null while the project has none. */
export function sendLaneConfirmCopy(
  input: {
    readonly projectTitle: string;
    readonly homeName: string | null;
    readonly lane: ModelLane;
    readonly keyName: string;
  },
  resolve: MessageResolver = m,
) {
  const { projectTitle, homeName, lane, keyName } = input;
  return {
    title:
      lane === "personal"
        ? resolve(msg("Use Personal in {projectTitle}?", { projectTitle }))
        : resolve(msg("Use the {keyName} key in {projectTitle}?", { keyName, projectTitle })),
    message:
      homeName === null
        ? resolve(
            msg(
              "{projectTitle} has no work key yet. This thread would use {keyName} from now on.",
              { projectTitle, keyName },
            ),
          )
        : resolve(
            msg("{projectTitle} uses {homeName}. This thread would use {keyName} from now on.", {
              projectTitle,
              homeName,
              keyName,
            }),
          ),
    confirmText: resolve(msg("Use {keyName} in this thread", { keyName })),
  };
}

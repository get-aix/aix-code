import { createThreadCostReadAtomFamily } from "@t3tools/client-runtime/state/threadCost";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentThreadDetails } from "./threads";

export const threadCostRead = createThreadCostReadAtomFamily(connectionAtomRuntime, {
  quietThreadAtom: environmentThreadDetails.quietThreadAtom,
});

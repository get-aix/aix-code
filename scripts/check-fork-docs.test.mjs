import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { findMissingForkDocUpdates } from "./check-fork-docs.mjs";

NodeTest.test("reports missing fork docs when fork feature code changes alone", () => {
  const missing = findMissingForkDocUpdates([
    "apps/server/src/orchestration-v2/threadCost.ts",
    "apps/web/src/components/chat/ThreadDetailsCost.tsx",
  ]);
  NodeAssert.equal(missing.length, 1);
  NodeAssert.equal(missing[0].id, "budgets-and-cost");
  NodeAssert.ok(missing[0].suggestedDocs.includes("docs/user/aix-budgets.md"));
});

NodeTest.test("stays quiet when a mapped fork doc is updated in the same change", () => {
  const missing = findMissingForkDocUpdates([
    "apps/server/src/orchestration-v2/threadCost.ts",
    "docs/user/aix-budgets.md",
  ]);
  NodeAssert.deepEqual(missing, []);
});

NodeTest.test("ignores test-only changes in fork code", () => {
  const missing = findMissingForkDocUpdates([
    "apps/server/src/aix/ModelCatalog.test.ts",
    "apps/server/src/orchestration-v2/threadCost.test.ts",
  ]);
  NodeAssert.deepEqual(missing, []);
});

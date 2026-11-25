import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";
import { UsageLimitsWork } from "./UsageLimitsWork";

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });

  it("does not show probe failure notices in pooled or work usage limits", async () => {
    const timedOutWork: ServerProvider = {
      ...managedChatGpt("aix-opencode-adCare", "adCare"),
      aixProfile: "adCare",
      aixProfileLabel: "adCare",
      usageLimits: {
        checkedAt,
        profileName: "adCare",
        windows: [],
        unavailable: {
          reason: "probeFailed",
          message: "The aix gateway budget request timed out.",
        },
      },
    };
    const failedPersonal: ServerProvider = {
      ...managedChatGpt("codex", "Codex"),
      usageLimits: {
        checkedAt,
        windows: [],
        unavailable: { reason: "probeFailed", message: "Could not read limits." },
      },
    };
    const presentations = new Map([
      [
        EnvironmentId.make("wslstation"),
        {
          entry: { target: { label: "wslstation" } },
          serverConfig: { providers: [timedOutWork, failedPersonal] },
        },
      ],
    ]);

    await using workScreen = await render(
      <UsageLimitsWork presentations={presentations} now={Date.parse(checkedAt)} />,
    );
    await expect
      .element(workScreen.getByText(/The aix gateway budget request timed out/))
      .not.toBeInTheDocument();

    await using pooledScreen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );
    await expect.element(pooledScreen.getByText(/Could not read limits/)).not.toBeInTheDocument();
  });
});

describe("UsageLimitsPooled next refill", () => {
  it("skips elapsed resets while waiting for refreshed account data", async () => {
    function account(instanceId: string, usedPercent: number, resetsAt: string): ServerProvider {
      return {
        ...managedChatGpt(instanceId, instanceId),
        usageLimits: {
          checkedAt,
          windows: [{ id: "weekly", label: "Weekly", kind: "weekly", usedPercent, resetsAt }],
        },
      };
    }
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              account("Work", 20, "2026-10-25T17:00:00.000Z"),
              account("Personal", 60, "2026-10-25T18:00:00.000Z"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse("2026-10-25T17:30:00Z")} />,
    );
    await expect.element(screen.getByText("↻ +30%", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("↻ +30% in 30m")).toBeVisible();

    await screen.rerender(
      <UsageLimitsPooled presentations={presentations} now={Date.parse("2026-10-25T18:00:00Z")} />,
    );
    await expect.element(screen.getByText(/^↻ \+\d+%$/)).not.toBeInTheDocument();
  });
});

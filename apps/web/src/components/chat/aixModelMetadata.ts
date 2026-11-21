import type { ServerProvider } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";
import { formatContextWindowTokens } from "../../lib/contextWindow";

export function aixCatalogStatus(
  provider: ServerProvider,
  aixProfile = provider.aixProfile,
  resolve: MessageResolver = m,
):
  | { readonly kind: "current" }
  | { readonly kind: "warning" | "stale" | "unavailable"; readonly message: string }
  | null {
  if (!aixProfile) return null;
  const message = provider.message?.trim();
  if (provider.status === "error") {
    return {
      kind: "unavailable",
      message: message || resolve(msg("The aix catalog is unavailable.")),
    };
  }
  if (provider.status === "warning" && message?.toLowerCase().includes("aix catalog stale")) {
    return {
      kind: "stale",
      message,
    };
  }
  if (provider.status === "warning") {
    return {
      kind: "warning",
      message: message || resolve(msg("The aix provider needs attention.")),
    };
  }
  return { kind: "current" };
}

const usdPerMillion = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function catalogMetadataRows(
  metadata: ServerProvider["models"][number]["catalogMetadata"],
  resolve: MessageResolver = m,
): ReadonlyArray<{ readonly label: string; readonly value: string }> {
  const unknown = resolve(msg("Unknown"));
  const price = (value: number | undefined) =>
    value === undefined
      ? unknown
      : resolve(msg("{price} / 1M tokens", { price: usdPerMillion.format(value) }));
  const tokens = (value: number) =>
    resolve(msg("{count} tokens", { count: formatContextWindowTokens(value) }));
  const efforts = metadata?.reasoning?.efforts;
  return [
    { label: resolve(msg("Family")), value: metadata?.family ?? unknown },
    {
      label: resolve(msg("Context window")),
      value: metadata?.contextTokens === undefined ? unknown : tokens(metadata.contextTokens),
    },
    {
      label: resolve(msg("Max output")),
      value: metadata?.maxOutputTokens === undefined ? unknown : tokens(metadata.maxOutputTokens),
    },
    { label: resolve(msg("Input")), value: price(metadata?.pricing?.inputPerMillionTokens) },
    { label: resolve(msg("Output")), value: price(metadata?.pricing?.outputPerMillionTokens) },
    {
      label: resolve(msg("Reasoning")),
      value: efforts?.length ? efforts.join(", ") : unknown,
    },
  ];
}

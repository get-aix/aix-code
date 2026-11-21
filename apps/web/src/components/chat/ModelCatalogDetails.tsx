import { useGT, useMessages } from "gt-react";
import { CheckIcon, CopyIcon, InfoIcon } from "lucide-react";
import { useState, type RefObject } from "react";
import type { ServerProvider } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { catalogMetadataRows } from "./aixModelMetadata";
import { namedClipboardTarget, useCopyToClipboard } from "../../hooks/useCopyToClipboard";

export function ModelCatalogDetails(props: {
  modelId: string;
  name: string;
  metadata: ServerProvider["models"][number]["catalogMetadata"];
  searchInputRef: RefObject<HTMLInputElement | null>;
  onEscape?: (() => void) | undefined;
}) {
  const gt = useGT();
  const m = useMessages();
  const [copyFailed, setCopyFailed] = useState(false);
  const { copyToClipboard, isCopied: copied } = useCopyToClipboard({
    target: namedClipboardTarget("model ID"),
    onError: () => setCopyFailed(true),
    onCopy: () => setCopyFailed(false),
  });
  const rows = catalogMetadataRows(props.metadata, m);

  const copyModelId = async () => {
    copyToClipboard(props.modelId, undefined);
    setCopyFailed(false);
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={gt("Model details for {model}", { model: props.name })}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") props.onEscape?.();
              if (event.key === "Enter" || event.key === " ") event.stopPropagation();
            }}
          >
            <InfoIcon aria-hidden="true" />
          </Button>
        }
      />
      <PopoverPopup
        width="sm"
        side="top"
        align="end"
        className="max-w-[calc(100vw-1rem)]"
        finalFocus={() => props.searchInputRef.current}
        data-model-picker-option-menu
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="space-y-2 text-xs">
          <p className="truncate font-medium">{props.name}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 break-words text-right">{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex min-w-0 items-center gap-1 border-t border-border/70 pt-2">
            <code className="min-w-0 flex-1 break-all text-muted-foreground">{props.modelId}</code>
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={
                copyFailed
                  ? gt("Could not copy model ID")
                  : copied
                    ? gt("Model ID copied")
                    : gt("Copy model ID")
              }
              onClick={() => void copyModelId()}
            >
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            </Button>
          </div>
          <p className="sr-only" aria-live="polite">
            {copyFailed ? gt("Could not copy model ID") : copied ? gt("Model ID copied") : ""}
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

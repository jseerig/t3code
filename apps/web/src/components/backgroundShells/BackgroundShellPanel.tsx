import {
  type BackgroundShell,
  type BackgroundShellStatus,
  EMPTY_BACKGROUND_SHELL_LOG,
} from "@t3tools/client-runtime/state/backgroundShells";
import { type ScopedThreadRef, RuntimeTaskId } from "@t3tools/contracts";
import { ExternalLink, ScrollText, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { backgroundShellEnvironment } from "~/state/backgroundShells";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  backgroundShellTabTitle,
  detectLocalServerUrls,
  stripTerminalControl,
} from "./backgroundShells.logic";

const STATUS_LABELS: Record<BackgroundShellStatus, string> = {
  running: "Running",
  completed: "Finished",
  failed: "Failed",
  stopped: "Stopped",
  interrupted: "Ended with session",
};

/** Pixels from the bottom that still count as "following" the log. */
const FOLLOW_THRESHOLD_PX = 32;

export function BackgroundShellPanel({
  threadRef,
  shell,
}: {
  threadRef: ScopedThreadRef;
  shell: BackgroundShell | null;
}) {
  if (!shell) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ScrollText aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">Process not found</p>
        <p className="max-w-56 text-xs text-muted-foreground">
          This thread no longer lists the process. Its log may have been cleaned up.
        </p>
      </div>
    );
  }
  return <BackgroundShellLogView threadRef={threadRef} shell={shell} />;
}

function BackgroundShellLogView({
  threadRef,
  shell,
}: {
  threadRef: ScopedThreadRef;
  shell: BackgroundShell;
}) {
  const logQuery = useEnvironmentQuery(
    shell.hasLog
      ? backgroundShellEnvironment.log({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, taskId: RuntimeTaskId.make(shell.taskId) },
        })
      : null,
  );
  const log = logQuery.data ?? EMPTY_BACKGROUND_SHELL_LOG;
  const text = useMemo(() => stripTerminalControl(log.text), [log.text]);
  const urls = useMemo(() => detectLocalServerUrls(text), [text]);

  // Name the tab after the address the process announced, once it is known.
  const title = backgroundShellTabTitle(shell, urls);
  useEffect(() => {
    useRightPanelStore.getState().renameProcess(threadRef, shell.taskId, title);
  }, [shell.taskId, threadRef, title]);

  const openLink = useOpenLink(threadRef);
  const stop = useAtomCommand(backgroundShellEnvironment.stop);
  const [stopping, setStopping] = useState(false);
  const running = shell.status === "running";

  // Stay pinned to the newest output until the user scrolls up to read.
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-1.5 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              running
                ? "bg-emerald-500"
                : shell.status === "failed"
                  ? "bg-destructive"
                  : "bg-muted-foreground/50",
            )}
            aria-hidden
          />
          <span className="text-xs font-medium">{STATUS_LABELS[shell.status]}</span>
          <div className="ms-auto flex items-center gap-1">
            {urls.map((url) => (
              <Button
                key={url}
                size="xs"
                variant="outline"
                onClick={(event) => void openLink(url, { event })}
              >
                <ExternalLink />
                {new URL(url).host}
              </Button>
            ))}
            {running ? (
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={stopping}
                onClick={async () => {
                  setStopping(true);
                  await stop({
                    environmentId: threadRef.environmentId,
                    input: {
                      threadId: threadRef.threadId,
                      taskId: RuntimeTaskId.make(shell.taskId),
                    },
                  });
                  setStopping(false);
                }}
              >
                <Square />
                {stopping ? "Stopping…" : "Stop"}
              </Button>
            ) : null}
          </div>
        </div>
        <code className="line-clamp-3 break-all font-mono text-[.7rem] text-muted-foreground">
          {shell.command ?? shell.description ?? shell.taskId}
        </code>
      </header>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD_PX;
        }}
      >
        {!shell.hasLog ? (
          <p className="p-3 text-xs text-muted-foreground">No log is available for this process.</p>
        ) : logQuery.error !== null ? (
          <p className="p-3 text-xs text-destructive">{logQuery.error}</p>
        ) : !log.loaded ? (
          <p className="p-3 text-xs text-muted-foreground">Loading log…</p>
        ) : (
          <>
            {log.truncated ? (
              <p className="px-3 pt-2 text-[.7rem] text-muted-foreground">
                Earlier output is not shown.
              </p>
            ) : null}
            <pre className="whitespace-pre-wrap break-all px-3 py-2 font-mono text-[.72rem] leading-relaxed">
              {text.length > 0 ? (
                text
              ) : (
                <span className="text-muted-foreground">No output yet.</span>
              )}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

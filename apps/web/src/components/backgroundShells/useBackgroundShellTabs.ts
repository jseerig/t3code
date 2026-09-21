import type { BackgroundShell } from "@t3tools/client-runtime/state/backgroundShells";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useRightPanelStore } from "~/rightPanelStore";

import { backgroundShellTabTitle } from "./backgroundShells.logic";

/**
 * Gives every background process of the open thread a right-panel tab.
 * A process that starts while the thread is open reveals its tab; processes
 * found when the thread opens get quiet tabs (running ones only), so
 * revisiting a thread does not reopen tabs of processes that already ended.
 */
export function useBackgroundShellTabs(
  threadRef: ScopedThreadRef | null,
  shells: ReadonlyArray<BackgroundShell>,
): void {
  const seen = useRef<{ threadKey: string | null; taskIds: Set<string> }>({
    threadKey: null,
    taskIds: new Set(),
  });

  useEffect(() => {
    if (!threadRef) return;
    const threadKey = scopedThreadKey(threadRef);
    const firstPass = seen.current.threadKey !== threadKey;
    if (firstPass) {
      seen.current = { threadKey, taskIds: new Set() };
    }
    const { addProcess } = useRightPanelStore.getState();
    for (const shell of shells) {
      if (seen.current.taskIds.has(shell.taskId)) continue;
      seen.current.taskIds.add(shell.taskId);
      if (firstPass && shell.status !== "running") continue;
      addProcess(
        threadRef,
        { taskId: shell.taskId, title: backgroundShellTabTitle(shell, []) },
        !firstPass,
      );
    }
  }, [shells, threadRef]);
}

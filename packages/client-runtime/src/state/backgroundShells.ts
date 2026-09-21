/**
 * Background shells: processes an agent keeps running after its tool call
 * returned (Claude `run_in_background`, task type `local_bash`). The list is
 * folded from the thread's persisted task activities; each shell's log
 * streams from the server, which resolves the log file itself.
 */
import {
  type BackgroundShellLogEvent,
  type OrchestrationThreadActivity,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";
import { createEnvironmentRpcCommand, createEnvironmentSubscriptionAtomFamily } from "./runtime.ts";

export type BackgroundShellStatus = "running" | "completed" | "failed" | "stopped" | "interrupted";

export interface BackgroundShell {
  readonly taskId: string;
  readonly command: string | null;
  readonly description: string | null;
  readonly status: BackgroundShellStatus;
  readonly hasLog: boolean;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

const BACKGROUND_SHELL_TASK_TYPES: ReadonlySet<string> = new Set(["local_bash"]);

interface MutableShell {
  taskId: string;
  command: string | null;
  description: string | null;
  status: BackgroundShellStatus;
  backgrounded: boolean;
  hasLog: boolean;
  startedAt: string;
  endedAt: string | null;
}

const stringField = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

function statusFromPayload(
  kind: string,
  payload: Record<string, unknown>,
): BackgroundShellStatus | null {
  const status = payload.status;
  if (kind === "task.completed") {
    return status === "failed" ? "failed" : status === "stopped" ? "stopped" : "completed";
  }
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "stopped";
    case "interrupted":
      return "interrupted";
    case "running":
      return "running";
    default:
      return null;
  }
}

/**
 * Only shells that actually went to the background are listed; a command the
 * agent waited on in the foreground stays an ordinary work-log row. Pass
 * `sessionLive: false` once the provider session is gone: its shells died
 * with it, even if their final rows never arrived.
 */
export function foldBackgroundShellActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  options?: { readonly sessionLive?: boolean },
): ReadonlyArray<BackgroundShell> {
  const shells = new Map<string, MutableShell>();
  for (const activity of activities) {
    if (!activity.kind.startsWith("task.")) {
      continue;
    }
    const payload = activity.payload;
    if (payload === null || typeof payload !== "object") {
      continue;
    }
    const record = payload as Record<string, unknown>;
    const taskId = stringField(record, "taskId");
    const taskType = stringField(record, "taskType");
    if (taskId === null || taskType === null || !BACKGROUND_SHELL_TASK_TYPES.has(taskType)) {
      continue;
    }
    const shell: MutableShell = shells.get(taskId) ?? {
      taskId,
      command: null,
      description: null,
      status: "running",
      backgrounded: false,
      hasLog: false,
      startedAt: activity.createdAt,
      endedAt: null,
    };
    shells.set(taskId, shell);

    shell.command = stringField(record, "command") ?? shell.command;
    shell.description =
      shell.description ?? stringField(record, "detail") ?? stringField(record, "title");
    shell.backgrounded ||= record.isBackgrounded === true;
    shell.hasLog ||= stringField(record, "outputFile") !== null;
    const status = statusFromPayload(activity.kind, record);
    if (status !== null && (shell.status === "running" || status !== "running")) {
      shell.status = status;
    }
    if (shell.status !== "running") {
      shell.endedAt = shell.endedAt ?? stringField(record, "endedAt") ?? activity.createdAt;
    }
  }

  const result: BackgroundShell[] = [];
  for (const shell of shells.values()) {
    if (!shell.backgrounded) {
      continue;
    }
    const orphaned = options?.sessionLive === false && shell.status === "running";
    result.push({
      taskId: shell.taskId,
      command: shell.command,
      description: shell.description,
      status: orphaned ? "interrupted" : shell.status,
      hasLog: shell.hasLog,
      startedAt: shell.startedAt,
      endedAt: shell.endedAt,
    });
  }
  return result;
}

export interface BackgroundShellLogState {
  /** False until the server's first snapshot arrived. */
  readonly loaded: boolean;
  readonly text: string;
  /** The beginning of the log was dropped (server snapshot or client cap). */
  readonly truncated: boolean;
}

/** Mirrors the server snapshot cap so long-running shells stay cheap to render. */
export const BACKGROUND_SHELL_LOG_MAX_CHARS = 512 * 1024;

export const EMPTY_BACKGROUND_SHELL_LOG: BackgroundShellLogState = {
  loaded: false,
  text: "",
  truncated: false,
};

export function applyBackgroundShellLogEvent(
  state: BackgroundShellLogState,
  event: BackgroundShellLogEvent,
): BackgroundShellLogState {
  if (event.type === "snapshot") {
    return { loaded: true, text: event.text, truncated: event.truncated };
  }
  const text = state.text + event.text;
  if (text.length <= BACKGROUND_SHELL_LOG_MAX_CHARS) {
    return { loaded: true, text, truncated: state.truncated };
  }
  const tail = text.slice(text.length - BACKGROUND_SHELL_LOG_MAX_CHARS);
  const firstNewline = tail.indexOf("\n");
  return {
    loaded: true,
    text: firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail,
    truncated: true,
  };
}

export function createBackgroundShellEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    log: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:background-shell:log",
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.subscribeBackgroundShellLog>) =>
        Stream.suspend(() =>
          subscribe(WS_METHODS.subscribeBackgroundShellLog, input).pipe(
            Stream.scan(EMPTY_BACKGROUND_SHELL_LOG, applyBackgroundShellLogEvent),
          ),
        ),
    }),
    stop: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:background-shell:stop",
      tag: WS_METHODS.backgroundShellStop,
    }),
  };
}

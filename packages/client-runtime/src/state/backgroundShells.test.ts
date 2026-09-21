import { describe, expect, it } from "vite-plus/test";
import { classifyTaskAgentKind, type OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  applyBackgroundShellLogEvent,
  BACKGROUND_SHELL_LOG_MAX_CHARS,
  EMPTY_BACKGROUND_SHELL_LOG,
  foldBackgroundShellActivities,
} from "./backgroundShells.ts";

let sequence = 0;
/** Post-ingestion rows: ingestion stamps agentKind on every task.* payload. */
function activity(kind: string, payload: Record<string, unknown>): OrchestrationThreadActivity {
  sequence += 1;
  return {
    id: `activity-${sequence}`,
    tone: "info",
    kind,
    summary: kind,
    payload: {
      ...payload,
      agentKind: classifyTaskAgentKind({
        taskType: typeof payload.taskType === "string" ? payload.taskType : undefined,
      }),
    },
    turnId: null,
    createdAt: `2026-09-21T10:00:${String(sequence).padStart(2, "0")}.000Z`,
  } as unknown as OrchestrationThreadActivity;
}

const devServer = [
  activity("task.started", {
    taskId: "b1",
    taskType: "local_bash",
    detail: "Start the dev server",
    command: "npm run dev",
  }),
  activity("task.updated", {
    taskId: "b1",
    taskType: "local_bash",
    isBackgrounded: true,
    command: "npm run dev",
    outputFile: "/tmp/claude/s/tasks/b1.output",
  }),
];

describe("foldBackgroundShellActivities", () => {
  it("lists a backgrounded shell with its command and log", () => {
    expect(foldBackgroundShellActivities(devServer)).toEqual([
      {
        taskId: "b1",
        command: "npm run dev",
        description: "Start the dev server",
        status: "running",
        hasLog: true,
        startedAt: devServer[0]!.createdAt,
        endedAt: null,
      },
    ]);
  });

  it("leaves out shells the agent waited on and non-shell tasks", () => {
    const shells = foldBackgroundShellActivities([
      activity("task.started", { taskId: "fg", taskType: "local_bash", command: "npm test" }),
      activity("task.completed", { taskId: "fg", taskType: "local_bash", status: "completed" }),
      activity("task.started", { taskId: "agent", taskType: "local_agent" }),
      activity("task.updated", { taskId: "agent", taskType: "local_agent", isBackgrounded: true }),
    ]);
    expect(shells).toEqual([]);
  });

  it("keeps a stopped shell with its end time and never revives it", () => {
    const stopped = activity("task.completed", {
      taskId: "b1",
      taskType: "local_bash",
      status: "stopped",
    });
    const [shell] = foldBackgroundShellActivities([
      ...devServer,
      stopped,
      activity("task.updated", { taskId: "b1", taskType: "local_bash", status: "running" }),
    ]);
    expect(shell?.status).toBe("stopped");
    expect(shell?.endedAt).toBe(stopped.createdAt);
  });

  it("marks running shells interrupted once their session is gone", () => {
    const [shell] = foldBackgroundShellActivities(devServer, { sessionLive: false });
    expect(shell?.status).toBe("interrupted");
  });
});

describe("applyBackgroundShellLogEvent", () => {
  it("replaces the buffer on every snapshot, so a reconnect cannot duplicate lines", () => {
    const first = applyBackgroundShellLogEvent(EMPTY_BACKGROUND_SHELL_LOG, {
      type: "snapshot",
      text: "a\n",
      truncated: false,
    });
    const appended = applyBackgroundShellLogEvent(first, { type: "append", text: "b\n" });
    const resubscribed = applyBackgroundShellLogEvent(appended, {
      type: "snapshot",
      text: "a\nb\n",
      truncated: false,
    });
    expect(appended.text).toBe("a\nb\n");
    expect(resubscribed).toEqual({ loaded: true, text: "a\nb\n", truncated: false });
  });

  it("drops whole lines from the start once the buffer is full", () => {
    const line = `${"x".repeat(1023)}\n`;
    const full = applyBackgroundShellLogEvent(EMPTY_BACKGROUND_SHELL_LOG, {
      type: "snapshot",
      text: line.repeat(BACKGROUND_SHELL_LOG_MAX_CHARS / line.length),
      truncated: false,
    });
    const next = applyBackgroundShellLogEvent(full, { type: "append", text: "newest\n" });
    expect(next.truncated).toBe(true);
    expect(next.text.length).toBeLessThanOrEqual(BACKGROUND_SHELL_LOG_MAX_CHARS);
    expect(next.text.startsWith("x")).toBe(true);
    expect(next.text.endsWith(`${line}newest\n`)).toBe(true);
  });
});

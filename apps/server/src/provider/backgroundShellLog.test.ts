import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { BackgroundShellLogEvent, OrchestrationThreadActivity } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  findBackgroundShellLogPath,
  isBackgroundShellLogPath,
  streamBackgroundShellLog,
} from "./backgroundShellLog.ts";

const taskActivity = (payload: Record<string, unknown>) =>
  ({
    id: `activity-${String(payload.taskId)}-${String(payload.outputFile)}`,
    createdAt: "2026-09-21T10:00:00.000Z",
    tone: "info",
    kind: "task.updated",
    summary: "Task updated",
    payload,
    turnId: null,
  }) as unknown as OrchestrationThreadActivity;

describe("background shell log path", () => {
  it("accepts only the task's own log file inside a tasks directory", () => {
    assert.isTrue(isBackgroundShellLogPath("/tmp/claude-501/app/s1/tasks/b1.output", "b1"));
    assert.isTrue(isBackgroundShellLogPath("C:\\Temp\\claude\\s1\\tasks\\b1.output", "b1"));
    assert.isFalse(isBackgroundShellLogPath("/tmp/claude-501/app/s1/tasks/b2.output", "b1"));
    assert.isFalse(isBackgroundShellLogPath("/home/me/.ssh/b1.output", "b1"));
    assert.isFalse(isBackgroundShellLogPath("tasks/b1.output", "b1"));
  });

  it("resolves the newest recorded path and ignores other tasks", () => {
    const activities = [
      taskActivity({ taskId: "b1", outputFile: "/tmp/a/tasks/b1.output" }),
      taskActivity({ taskId: "b2", outputFile: "/tmp/b/tasks/b2.output" }),
      taskActivity({ taskId: "b1", status: "running" }),
    ];
    assert.equal(findBackgroundShellLogPath(activities, "b1"), "/tmp/a/tasks/b1.output");
    assert.equal(findBackgroundShellLogPath(activities, "b3"), undefined);
  });

  it("refuses a recorded path that does not look like the task's log", () => {
    const activities = [taskActivity({ taskId: "b1", outputFile: "/etc/passwd" })];
    assert.equal(findBackgroundShellLogPath(activities, "b1"), undefined);
  });
});

it.layer(NodeServices.layer)("background shell log stream", (it) => {
  it.effect("sends the existing log, then what the process appends", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-background-shell-log-" });
      const logPath = path.join(root, "tasks", "b1.output");
      yield* fs.makeDirectory(path.dirname(logPath), { recursive: true });
      yield* fs.writeFileString(logPath, "ready on http://localhost:8000\n");

      const events = yield* Queue.unbounded<BackgroundShellLogEvent>();
      yield* streamBackgroundShellLog(logPath).pipe(
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkScoped,
      );
      assert.deepEqual(yield* Queue.take(events), {
        type: "snapshot",
        text: "ready on http://localhost:8000\n",
        truncated: false,
      });

      yield* fs.writeFileString(logPath, "GET / 200 ✓\n", { flag: "a" });
      yield* TestClock.adjust("1 second");
      assert.deepEqual(yield* Queue.take(events), { type: "append", text: "GET / 200 ✓\n" });
    }),
  );

  it.effect("keeps only whole lines from the tail of a large log", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-background-shell-log-" });
      const logPath = path.join(root, "b1.output");
      yield* fs.writeFileString(logPath, "first line\nsecond line\nthird line\n");

      const [snapshot] = Array.from(
        yield* streamBackgroundShellLog(logPath, { maxSnapshotBytes: 16 }).pipe(
          Stream.take(1),
          Stream.runCollect,
        ),
      );
      assert.deepEqual(snapshot, { type: "snapshot", text: "third line\n", truncated: true });
    }),
  );
});

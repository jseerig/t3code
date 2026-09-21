/**
 * Log access for background shells (processes an agent keeps running after
 * its tool call returns). The adapter records each shell's log file on its
 * task activities; this module resolves that path for a task and tails it.
 *
 * Clients only ever name a thread and task. The path comes from the thread's
 * own persisted activities and must look like the provider's task log
 * (`…/tasks/<taskId>.output`), so a client cannot point this at other files.
 */
import type { BackgroundShellLogEvent, OrchestrationThreadActivity } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

export const BACKGROUND_SHELL_ACTIVITY_KINDS: ReadonlyArray<string> = [
  "task.started",
  "task.updated",
  "task.completed",
];

/** A snapshot keeps the tail of larger logs; the client caps its buffer similarly. */
export const BACKGROUND_SHELL_LOG_SNAPSHOT_MAX_BYTES = 512 * 1024;
const BACKGROUND_SHELL_LOG_POLL_INTERVAL = "500 millis";

const ABSOLUTE_PATH = /^(?:\/|[a-zA-Z]:[\\/])/;

export function isBackgroundShellLogPath(filePath: string, taskId: string): boolean {
  const segments = filePath.split(/[\\/]/);
  return (
    ABSOLUTE_PATH.test(filePath) &&
    segments.at(-1) === `${taskId}.output` &&
    segments.at(-2) === "tasks"
  );
}

/** Newest log path recorded for the task, if it passes the shape check. */
export function findBackgroundShellLogPath(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  taskId: string,
): string | undefined {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const payload = activities[index]?.payload;
    if (payload === null || typeof payload !== "object") {
      continue;
    }
    const record = payload as Record<string, unknown>;
    if (record.taskId !== taskId || typeof record.outputFile !== "string") {
      continue;
    }
    return isBackgroundShellLogPath(record.outputFile, taskId) ? record.outputFile : undefined;
  }
  return undefined;
}

const readRange = (file: FileSystem.File, start: number, end: number) =>
  file
    .seek(BigInt(start), "start")
    .pipe(
      Effect.andThen(file.readAlloc(end - start)),
      Effect.map(Option.getOrElse(() => new Uint8Array())),
    );

/**
 * Streams a log file as one `snapshot` (the tail when it exceeds
 * `maxSnapshotBytes`) followed by `append` chunks as the file grows. Reads are
 * byte-offset based and decoded incrementally, so multi-byte characters split
 * across reads stay intact.
 */
export const streamBackgroundShellLog = (
  filePath: string,
  options: { readonly maxSnapshotBytes?: number } = {},
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = yield* fs.open(filePath, { flag: "r" });
      const maxSnapshotBytes = options.maxSnapshotBytes ?? BACKGROUND_SHELL_LOG_SNAPSHOT_MAX_BYTES;
      const decoder = new TextDecoder();
      const size = Number((yield* file.stat).size);
      const start = Math.max(0, size - maxSnapshotBytes);
      let offset = size;

      let text = decoder.decode(yield* readRange(file, start, size), { stream: true });
      if (start > 0) {
        // Drop the partial first line of a truncated tail.
        const firstNewline = text.indexOf("\n");
        text = firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
      }
      const snapshot: BackgroundShellLogEvent = { type: "snapshot", text, truncated: start > 0 };

      const readAppended = Effect.gen(function* () {
        const nextSize = Number((yield* file.stat).size);
        if (nextSize <= offset) {
          offset = Math.min(offset, nextSize);
          return [];
        }
        const bytes = yield* readRange(file, offset, nextSize);
        offset += bytes.length;
        const appended = decoder.decode(bytes, { stream: true });
        return appended.length > 0
          ? [{ type: "append", text: appended } satisfies BackgroundShellLogEvent]
          : [];
      });

      const appends = Stream.fromSchedule(Schedule.spaced(BACKGROUND_SHELL_LOG_POLL_INTERVAL)).pipe(
        Stream.mapEffect(() => readAppended),
        Stream.flattenIterable,
      );
      return Stream.concat(Stream.make(snapshot), appends);
    }),
  );

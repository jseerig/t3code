import * as Schema from "effect/Schema";
import { RuntimeTaskId, ThreadId } from "./baseSchemas.ts";

/**
 * Background shells are processes an agent keeps running after its tool call
 * returns (Claude `run_in_background`, task type `local_bash`). Clients list
 * them from the thread's task activities and read their logs through these
 * RPCs; the server resolves the log file itself and never accepts a path.
 */
export const BackgroundShellRef = Schema.Struct({
  threadId: ThreadId,
  taskId: RuntimeTaskId,
});
export type BackgroundShellRef = typeof BackgroundShellRef.Type;

/**
 * Log stream: always a full `snapshot` first (also after a reconnect), then
 * `append` chunks as the process writes. A snapshot of a large log keeps only
 * its tail and sets `truncated`.
 */
const BackgroundShellLogSnapshotEvent = Schema.Struct({
  type: Schema.Literal("snapshot"),
  text: Schema.String,
  truncated: Schema.Boolean,
});

const BackgroundShellLogAppendEvent = Schema.Struct({
  type: Schema.Literal("append"),
  text: Schema.String,
});

export const BackgroundShellLogEvent = Schema.Union([
  BackgroundShellLogSnapshotEvent,
  BackgroundShellLogAppendEvent,
]);
export type BackgroundShellLogEvent = typeof BackgroundShellLogEvent.Type;

export class BackgroundShellLogError extends Schema.TaggedError<BackgroundShellLogError>()(
  "BackgroundShellLogError",
  {
    threadId: ThreadId,
    taskId: RuntimeTaskId,
    reason: Schema.Literals(["not-found", "unreadable"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "not-found"
      ? `No log is known for background process ${this.taskId}.`
      : `Could not read the log of background process ${this.taskId}.`;
  }
}

export class BackgroundShellStopError extends Schema.TaggedError<BackgroundShellStopError>()(
  "BackgroundShellStopError",
  {
    threadId: ThreadId,
    taskId: RuntimeTaskId,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Could not stop background process ${this.taskId}: ${this.detail}`;
  }
}

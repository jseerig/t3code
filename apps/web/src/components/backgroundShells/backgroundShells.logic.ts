import type { BackgroundShell } from "@t3tools/client-runtime/state/backgroundShells";

import { extractTerminalLinks } from "~/terminal-links";

/** Removes ANSI escape sequences and control characters so logs read as plain text. */
export function stripTerminalControl(text: string): string {
  return (
    text
      .replace(
        // oxlint-disable-next-line no-control-regex
        /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]/g,
        "",
      )
      // A bare carriage return redraws the line (spinners, progress bars).
      .replace(/\r(?!\n)/g, "\n")
      // oxlint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
  );
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "[::]",
]);

/**
 * Local server addresses a process announced in its log, in first-seen order.
 * Wildcard binds (0.0.0.0, ::) are rewritten to localhost so they open.
 */
export function detectLocalServerUrls(log: string, limit = 3): string[] {
  const origins = new Map<string, string>();
  for (const line of log.split("\n")) {
    for (const match of extractTerminalLinks(line)) {
      if (match.kind !== "url") continue;
      let url: URL;
      try {
        url = new URL(match.text);
      } catch {
        continue;
      }
      if (!LOCAL_HOSTS.has(url.hostname) || url.port === "") continue;
      if (url.hostname === "0.0.0.0" || url.hostname === "[::]") url.hostname = "localhost";
      if (!origins.has(url.origin)) origins.set(url.origin, url.href);
      if (origins.size >= limit) return [...origins.values()];
    }
  }
  return [...origins.values()];
}

const TAB_TITLE_MAX_LENGTH = 32;

/** Tab label: the announced address once known, otherwise the command. */
export function backgroundShellTabTitle(shell: BackgroundShell, urls: readonly string[]): string {
  const [firstUrl] = urls;
  if (firstUrl) {
    return new URL(firstUrl).host;
  }
  const label = shell.command ?? shell.description ?? "Process";
  return label.length > TAB_TITLE_MAX_LENGTH
    ? `${label.slice(0, TAB_TITLE_MAX_LENGTH - 1)}…`
    : label;
}

import { describe, expect, it } from "vite-plus/test";
import type { BackgroundShell } from "@t3tools/client-runtime/state/backgroundShells";

import {
  backgroundShellTabTitle,
  detectLocalServerUrls,
  stripTerminalControl,
} from "./backgroundShells.logic";

const shell = (command: string | null): BackgroundShell => ({
  taskId: "b1",
  command,
  description: "Start the dev server",
  status: "running",
  hasLog: true,
  startedAt: "2026-09-21T10:00:00.000Z",
  endedAt: null,
});

describe("stripTerminalControl", () => {
  it("removes colors and turns progress redraws into lines", () => {
    expect(stripTerminalControl("\x1b[32m✓\x1b[0m ready\r\nbuilding 10%\rbuilding 90%")).toBe(
      "✓ ready\r\nbuilding 10%\nbuilding 90%",
    );
  });
});

describe("detectLocalServerUrls", () => {
  it("finds announced local servers once each, in order", () => {
    const log = [
      "  ➜  Local:   http://localhost:8000/",
      "  ➜  Network: http://192.168.1.4:8000/",
      "Medusa listening on http://0.0.0.0:9000",
      "GET http://localhost:8000/api/cart 200",
      "Docs at https://docs.medusajs.com",
    ].join("\n");
    expect(detectLocalServerUrls(log)).toEqual([
      "http://localhost:8000/",
      "http://localhost:9000/",
    ]);
  });

  it("ignores local addresses without a port", () => {
    expect(detectLocalServerUrls("see http://localhost/readme")).toEqual([]);
  });
});

describe("backgroundShellTabTitle", () => {
  it("prefers the announced address over the command", () => {
    expect(backgroundShellTabTitle(shell("npm run dev"), ["http://localhost:8000/"])).toBe(
      "localhost:8000",
    );
    expect(backgroundShellTabTitle(shell("npm run dev"), [])).toBe("npm run dev");
  });

  it("shortens long commands", () => {
    const title = backgroundShellTabTitle(
      shell("docker exec -i -u node -w /workspaces/ljb-hermes app npm run dev"),
      [],
    );
    expect(title).toHaveLength(32);
    expect(title.endsWith("…")).toBe(true);
  });
});

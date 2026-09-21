import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";

const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const panel = () => selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);

beforeEach(() => {
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

describe("background process tabs", () => {
  it("opens a closed panel on a newly started process", () => {
    useRightPanelStore.getState().addProcess(ref, { taskId: "b1", title: "npm run dev" }, true);
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "process:b1" });
  });

  it("does not take focus from a tab the user is looking at", () => {
    const store = useRightPanelStore.getState();
    store.open(ref, "diff");
    store.addProcess(ref, { taskId: "b1", title: "npm run dev" }, true);
    expect(panel().activeSurfaceId).toBe("diff");
    expect(panel().surfaces.map((surface) => surface.id)).toEqual(["diff", "process:b1"]);
  });

  it("adds a quiet tab without opening the panel", () => {
    useRightPanelStore.getState().addProcess(ref, { taskId: "b1", title: "npm run dev" }, false);
    expect(panel()).toMatchObject({ isOpen: false, activeSurfaceId: null });
    expect(panel().surfaces).toHaveLength(1);
  });

  it("brings closed process tabs back and shows the newest", () => {
    const store = useRightPanelStore.getState();
    store.addProcess(ref, { taskId: "b1", title: "localhost:8000" }, true);
    store.addProcess(ref, { taskId: "b2", title: "localhost:9000" }, false);
    store.closeSurface(ref, "process:b1");
    store.closeSurface(ref, "process:b2");
    store.openProcesses(ref, [
      { taskId: "b1", title: "npm run dev" },
      { taskId: "b2", title: "npm run medusa" },
    ]);
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "process:b2" });
    expect(panel().surfaces.map((surface) => surface.id)).toEqual(["process:b1", "process:b2"]);
  });
});

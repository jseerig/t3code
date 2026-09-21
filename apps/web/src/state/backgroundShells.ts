import { createBackgroundShellEnvironmentAtoms } from "@t3tools/client-runtime/state/backgroundShells";

import { connectionAtomRuntime } from "../connection/runtime";

export const backgroundShellEnvironment =
  createBackgroundShellEnvironmentAtoms(connectionAtomRuntime);

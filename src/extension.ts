import { workspace, ExtensionContext, TextDocumentChangeEvent } from "vscode";

import {
  logChange,
  updateConcreteCheckpoints,
  getWorkspacePath,
} from "./tracking";

import { VacuumConfig, Language, load_config } from "./config";


let updateCheckpointTimer: NodeJS.Timeout | null = null;
let config: VacuumConfig = load_config();


/** 
 * Returns the time of an operation in milliseconds.
*/
async function timeit<T>(f: () => Promise<T>): Promise<number> {
  const start = process.hrtime.bigint();
  await f();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
}


/**
 * Sets the checkpoint timer to update concrete checkpoints in 3 seconds.
 * If the timer is already set, it clears it and resets it.
 */
function setCheckpointTimer(wsPath: string) {
  if (updateCheckpointTimer) {
    clearTimeout(updateCheckpointTimer);
  }

  updateCheckpointTimer = setTimeout(async () => {
    let time = await timeit(async () => {
      return updateConcreteCheckpoints(wsPath, config);
    });
    console.log(`[lean-vacuum] updated concrete checkpoints in ${time}ms`);
  }, 3000);
}


export async function activate(context: ExtensionContext) {
  // Right now no need for the config
  console.log("[lean-vacuum] activated");

  // Initial checkpoint update
  for (let ws of workspace.workspaceFolders ?? []) {
    let wsPath = ws.uri.fsPath;
    console.log("[lean-vacuum] updating concrete checkpoints for workspace:", wsPath);
    updateConcreteCheckpoints(wsPath, config);
    console.log("[lean-vacuum] done updating concrete checkpoints for workspace:", wsPath);
    // let time = await timeit(async () => {
    //   return updateConcreteCheckpoints(wsPath, config);
    // });
    // console.log(`[lean-vacuum] initial concrete checkpoint update in ${time}ms`);
  }

  // On change events
  const changeHook = workspace.onDidChangeTextDocument(async (e) => {
    // Clear timers
    if (updateCheckpointTimer) {
      clearTimeout(updateCheckpointTimer);
    }

    let wsPath = getWorkspacePath(e.document);
    if (wsPath === undefined) {
      return;
    }
    setCheckpointTimer(wsPath);

    console.log("[lean-vacuum] changed");
    const time = await timeit(async () => {
      return logChange(e, config);
    });
    console.log(`[lean-vacuum] logged change in ${time}ms`);
  });
  context.subscriptions.push(changeHook);


  // On configuration change events
  const configHook = workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("lean-vacuum")) {
      config = load_config();
    }
  });
  context.subscriptions.push(configHook);
}


export function deactivate(): void {

}

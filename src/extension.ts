import { workspace, ExtensionContext, TextDocumentChangeEvent } from "vscode";

import {
  logChange,
  updateConcreteCheckpoints,
  getWorkspacePath,
  getBaseCommit,
  getChangesDir
} from "./tracking";

import { upload } from "./upload";

import { VacuumConfig, Language, load_config } from "./config";


let updateCheckpointTimer: NodeJS.Timeout | null = null;
let uploadTimer: NodeJS.Timeout | null = null;
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

// const UPLOAD_TIME_MS = 5 * 60 * 1000;
const UPLOAD_TIME_MS = 20 * 1000;
const CHECKPOINT_TIME_MS = 3 * 1000;


/**
 * Sets the upload timer to upload changes every 5 minutes.
 */
function setUploadTimer(wsPath: string) {
  if (uploadTimer) {
    return;
  }

  console.log(`[lean-vacuum] setting upload timer`);
  uploadTimer = setTimeout(async () => {
    let time = await timeit(async () => {
      let baseCommit = getBaseCommit(wsPath);
      let changesDir = getChangesDir(wsPath, baseCommit);
      console.log(`[lean-vacuum] sending upload request`);
      await upload(changesDir);
    });
    console.log(`[lean-vacuum] uploaded changes in ${time}ms`);
    uploadTimer = null;
  }, UPLOAD_TIME_MS);
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
  }, CHECKPOINT_TIME_MS);
}


export async function activate(context: ExtensionContext) {
  // Right now no need for the config
  console.log("[lean-vacuum] activated");

  // Initial checkpoint update
  for (let ws of workspace.workspaceFolders ?? []) {
    let wsPath = ws.uri.fsPath;
    let time = await timeit(async () => {
      return updateConcreteCheckpoints(wsPath, config);
    });
    console.log(`[lean-vacuum] initial concrete checkpoint update in ${time}ms`);
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
    setUploadTimer(wsPath);

    console.log("[lean-vacuum] changed");
    logChange(e, config);
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

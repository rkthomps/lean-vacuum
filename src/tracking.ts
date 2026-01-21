import fs = require("fs");
import path = require("path");
import os = require("os");
import { Language, VacuumConfig } from "./config";

import { Edit, NewContentConcreteCheckpoint } from "./types";

import {
  extensions,
  workspace,
  TextDocument,
  TextDocumentChangeEvent,
} from "vscode";


export const CHANGES_NAME = ".changes";
export const CONCRETE_NAME = "concrete-history"; // ASSUMPTION: A file being edited must first exist on disk.
export const EDITS_NAME = "edits-history";



interface GitState {
  head: string;
  lastTag: string | null;
}


type BaseCommit = GitState | null;


function isSubpath(p1: string, p2: string) {
  const relpath = path.relative(p1, p2);
  return relpath && !relpath.startsWith("..") && !path.isAbsolute(relpath);
}


function getBaseCommit(wsPath: string): BaseCommit {
  console.log(`[lean-vacuum] getting git extension for workspace: ${wsPath}`);
  const gitExtension = extensions.getExtension("vscode.git")?.exports;
  console.log(`[lean-vacuum] git extension: ${gitExtension}`);
  if (!gitExtension) {
    return null;
  }

  const api = gitExtension.getAPI(1);
  const repos = api.repositories;
  if (repos.length === 0) {
    return null;
  }

  const repo = repos.find((r: any) => wsPath.startsWith(r.rootUri.fsPath));
  if (!repo) {
    return null;
  }

  // const remote = repo.state.remotes[0]?.fetchUrl || "";
  const commit = repo.state.HEAD?.commit || "";
  return {
    head: commit,
    lastTag: null, /* TODO: For now, not shelling out to git to get the last tag */
  };

}




/**
 * Defines whether a directory is essential for tracking.
 */
function isEssentialDir(dir: string, config: VacuumConfig): boolean {
  const notLakeDir = !dir.endsWith(".lake");
  const notGitDir = !dir.endsWith(".git");
  const notChangesDir = !dir.endsWith(CHANGES_NAME);
  return notLakeDir && notGitDir && notChangesDir;
}

/**
 * Defines whether a file is essential for tracking.
 */
function isEssentialFile(file: string, config: VacuumConfig): boolean {
  const isLakeFileLean = path.basename(file) === "lakefile.lean";
  const isLakeFileToml = path.basename(file) === "lakefile.toml";
  const isLeanToolChain = path.basename(file) === "lean-toolchain";
  const isLeanSrc = file.endsWith(".lean");
  return isLakeFileLean || isLakeFileToml || isLeanToolChain || isLeanSrc;
}


/**
 * Recursively finds all essential files in a directory. 
 */
function findEssentialFiles(
  root: string,
  fileFilter: (file: string) => boolean,
  dirFilter: (dir: string) => boolean
): string[] {
  const rootStat = fs.lstatSync(root);
  if (rootStat.isDirectory()) {
    if (!dirFilter(root)) {
      return [];
    } else {
      let localChildren = fs
        .readdirSync(root)
        .map((c) => path.join(root, c))
        .sort();
      let allChildren: string[] = [];
      for (let child of localChildren) {
        allChildren = allChildren.concat(
          findEssentialFiles(child, fileFilter, dirFilter)
        );
      }
      return allChildren;
    }
  } else {
    console.log(`[lean-vacuum] Checking file: ${root}`);
    if (fileFilter(root)) {
      return [root];
    } else {
      return [];
    }
  }
}



/**
 * 
 * @returns The workspace in which this document resides. Returns undefined  
 * if no workspace can be found.
 */
export function getWorkspacePath(d: TextDocument): string | undefined {
  let wsFolders = workspace.workspaceFolders;
  if (wsFolders === undefined || wsFolders.length === 0) {
    console.warn("No workspace folders open. Will not save changes.");
    return undefined;
  }

  let candidates = [];
  const docPath = d.uri.fsPath;
  for (let folder of wsFolders) {
    if (isSubpath(folder.uri.fsPath, docPath)) {
      if (!path.isAbsolute(folder.uri.fsPath)) {
        throw new Error(`Workspace folder path ${folder.uri.fsPath} is not absolute`);
      }
      candidates.push(folder.uri.fsPath);
    }
  }

  if (candidates.length === 0) {
    console.warn("No workspace folder is an ancestor of document " + d.uri.fsPath);
    return undefined;
  }

  // Pick the longest path
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}


export interface TrackedFileResult {
  files: string[];
  baseCommit: BaseCommit;
}


/**
 * Get the tracked files in a workspace. 
 * This includes the following files:
 * - If there is no .git history, all of the files of interest in the workspace. 
 * - If there is a .git history, the intersection of the files of interest and 
 *   the files **modified** since the last commit. 
 * 
 * - TODO: The last commit could be the base commit.
 */
export function getTrackedFiles(
  wsPath: string,
  config: VacuumConfig
): TrackedFileResult {
  const allFiles = findEssentialFiles(
    wsPath,
    (f) => isEssentialFile(f, config),
    (d) => isEssentialDir(d, config)
  );
  console.log(`[lean-vacuum] checking base commit for workspace: ${wsPath}`);
  const baseCommit = getBaseCommit(wsPath);
  console.log(`[lean-vacuum] base commit for workspace ${wsPath}: ${baseCommit === null ? "null" : baseCommit.head}`);
  if (baseCommit === null) {
    return {
      files: allFiles,
      baseCommit: null,
    };
  } else {
    return {
      files: allFiles,
      baseCommit,
    };
  }
}


function getCommitName(baseCommit: BaseCommit): string {
  if (baseCommit === null) {
    return "no-git";
  } else {
    return baseCommit.head;
  }
}


function getEditsDir(wsPath: string, baseCommit: BaseCommit, filePath: string): string {
  const commitName = getCommitName(baseCommit);
  const fileRelPath = path.relative(wsPath, filePath);
  return path.join(wsPath, CHANGES_NAME, commitName, fileRelPath, EDITS_NAME);
}


/**
 * Returns the location of the given file's concrete checkpoint directory.
 */
function getConcreteCheckpointDir(wsPath: string, baseCommit: BaseCommit, filePath: string): string {
  const commitName = getCommitName(baseCommit);
  const fileRelPath = path.relative(wsPath, filePath);
  return path.join(wsPath, CHANGES_NAME, commitName, fileRelPath, CONCRETE_NAME);
}


/**
 * 
 * @returns The most recent entry in the concrete history for the given document. 
 */
function getLastConcreteCheckpointPath(concretePath: string): string | null {
  if (!fs.existsSync(concretePath)) {
    return null;
  }
  const concreteFiles = fs.readdirSync(concretePath);
  let mTimes: number[] = [];
  for (let f of concreteFiles) {
    let mtime = parseInt(path.basename(f), 10);
    mTimes.push(mtime);
  }
  if (mTimes.length === 0) {
    return null;
  } else {
    const largestTime = Math.max(...mTimes);
    return path.join(concretePath, largestTime.toString());
  }
}



/**
 * Updates the concrete checkpoint for a given file in the workspace. 
 * Simply checks if the file has been modified since the last checkpoint
 * was saved.
 * @param wsPath : The workspace path e.g. /work
 * @param filePath : The file path to update e.g. /work/file
 * @param config 
 * @param baseCommit 
 * @returns 
 */
function updateConcreteCheckpoint(
  wsPath: string,
  filePath: string,
  config: VacuumConfig,
  baseCommit: BaseCommit,
): void {
  const fileStat = fs.lstatSync(filePath);
  const concreteDir = getConcreteCheckpointDir(wsPath, baseCommit, filePath);

  if (fs.existsSync(concreteDir)) {
    const changeStat = fs.lstatSync(concreteDir);
    if (fileStat.mtime < changeStat.mtime) {
      // No update needed
      return;
    }
  }

  const newCheckpoint = NewContentConcreteCheckpoint.fromLeanFile(filePath);
  const checkpointSavePath = path.join(
    concreteDir,
    fileStat.mtime.getTime().toString()
  );
  newCheckpoint.save(checkpointSavePath);
}



/**
 * Updates the concrete checkpoints for all tracked files in the workspace.
 * This ensures that we can reproduce the state of the workspace when we  
 * want to replay an edit.
 */
export function updateConcreteCheckpoints(
  wsPath: string,
  config: VacuumConfig,
): void {
  console.log(`[lean-vacuum] getting tracked files for workspace: ${wsPath}`);
  const { files, baseCommit } = getTrackedFiles(wsPath, config);
  console.log(`[lean-vacuum] updating concrete checkpoints for ${files.length} files in workspace: ${wsPath}`);
  for (const filePath of files) {
    console.log(`[lean-vacuum] updating concrete checkpoint for file: ${filePath}`);
    updateConcreteCheckpoint(wsPath, filePath, config, baseCommit);
  }
}



/**
 * Logs a text document change to disk synchronously. 
 * Updates the concrete checkpoint for document associated with the change. 
 */
export function logChange(
  change: TextDocumentChangeEvent,
  config: VacuumConfig
): void {
  const wsPath = getWorkspacePath(change.document);
  if (wsPath === undefined) {
    return;
  }

  const filePath = change.document.uri.fsPath;
  const baseCommit = getBaseCommit(wsPath);

  updateConcreteCheckpoint(wsPath, filePath, config, baseCommit);
  const time = new Date();
  const newEdit = Edit.fromChange(change, time);
  const editsDir = getEditsDir(wsPath, baseCommit, filePath);
  const saveLoc = path.join(editsDir, time.getTime().toString());
  newEdit.save(saveLoc);
}


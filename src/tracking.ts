import fs = require("fs");
import path = require("path");
import { Language, VacuumConfig } from "./config";

import {
  workspace,
  ExtensionContext,
  TextDocument,
  TextDocumentChangeEvent,
  TextDocumentContentChangeEvent,
  Uri,
  Range,
  Position,
} from "vscode";

import { cwd } from "process";
import { dir } from "console";

export const CHANGES_NAME = ".changes";
export const CONCRETE_NAME = "concrete-history"; // ASSUMPTION: A file being edited must first exist on disk.
export const EDITS_NAME = "edits-history";


class NewContentConcreteCheckpoint {
  public readonly contents: string;
  public readonly mtime: Date;

  constructor(contents: string, mtime: Date) {
    this.contents = contents;
    this.mtime = mtime;
  }

  toJson(): any {
    return {
      type: "new",
      contents: this.contents,
      mtime: this.mtime.getTime(),
    };
  }

  save(p: string): void {
    const parent = path.dirname(p);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(this.toJson()));
  }

  static fromJson(json: any): NewContentConcreteCheckpoint {
    return new NewContentConcreteCheckpoint(
      json.contents,
      new Date(json.mtime)
    );
  }

  static fromLeanFile(p: string): NewContentConcreteCheckpoint {
    const contents = fs.readFileSync(p, "utf-8");
    const mtime = fs.lstatSync(p).mtime;
    return new NewContentConcreteCheckpoint(contents, mtime);
  }

  static load(p: string): NewContentConcreteCheckpoint {
    const jsonContents = fs.readFileSync(p, "utf-8");
    const json = JSON.parse(jsonContents);
    return NewContentConcreteCheckpoint.fromJson(json);
  }
}

class SameContentConcreteCheckpoint {
  public readonly prevMtime: Date;
  public readonly mtime: Date;

  constructor(prevMtime: Date, mtime: Date) {
    this.prevMtime = prevMtime;
    this.mtime = mtime;
  }

  toJson(): any {
    return {
      type: "same",
      prevMtime: this.prevMtime.getTime(),
      mtime: this.mtime.getTime(),
    };
  }

  save(p: string): void {
    const parent = path.dirname(p);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(this.toJson()));
  }

  static fromJson(json: any): SameContentConcreteCheckpoint {
    return new SameContentConcreteCheckpoint(
      new Date(json.prevMtime),
      new Date(json.mtime)
    );
  }

  static load(p: string): SameContentConcreteCheckpoint {
    const jsonContents = fs.readFileSync(p, "utf-8");
    const json = JSON.parse(jsonContents);
    return SameContentConcreteCheckpoint.fromJson(json);
  }
}

function loadConcreteCheckpoint(p: string): ConcreteCheckpoint {
  const jsonContents = fs.readFileSync(p, "utf-8");
  const json = JSON.parse(jsonContents);
  if (json.type === "new") {
    return NewContentConcreteCheckpoint.fromJson(json);
  } else if (json.type === "same") {
    return SameContentConcreteCheckpoint.fromJson(json);
  } else {
    throw new Error("Invalid checkpoint type");
  }
}

function loadLastNewConcreteCheckpoint(
  p: string
): NewContentConcreteCheckpoint {
  const concreteCheckpoint = loadConcreteCheckpoint(p);
  if (concreteCheckpoint instanceof NewContentConcreteCheckpoint) {
    return concreteCheckpoint;
  } else {
    const prevMtime = concreteCheckpoint.prevMtime;
    const prevCheckpointPath = path.join(
      path.dirname(p),
      prevMtime.getTime().toString()
    );
    return loadLastNewConcreteCheckpoint(prevCheckpointPath);
  }
}

type ConcreteCheckpoint =
  | NewContentConcreteCheckpoint
  | SameContentConcreteCheckpoint;


function posToJson(pos: Position): any {
  return {
    line: pos.line,
    character: pos.character,
  };
}

function posFromJson(json: any): Position {
  return new Position(json.line, json.character);
}

function rangeToJson(range: Range): any {
  return {
    start: posToJson(range.start),
    end: posToJson(range.end),
  };
}

function rangeFromJson(json: any): Range {
  return new Range(posFromJson(json.start), posFromJson(json.end));
}

class ContentChange {
  public readonly range: Range;
  public readonly text: string;
  public readonly rangeOffset: number;
  public readonly rangeLength: number;

  constructor(
    range: Range,
    text: string,
    rangeOffset: number,
    rangeLength: number
  ) {
    this.range = range;
    this.text = text;
    this.rangeOffset = rangeOffset;
    this.rangeLength = rangeLength;
  }

  toJson(): any {
    return {
      range: rangeToJson(this.range),
      text: this.text,
      rangeOffset: this.rangeOffset,
      rangeLength: this.rangeLength,
    };
  }

  static fromJson(json: any): ContentChange {
    return new ContentChange(
      json.range,
      json.text,
      json.rangeOffset,
      json.rangeLength
    );
  }

  static fromChange(change: TextDocumentContentChangeEvent): ContentChange {
    return new ContentChange(
      change.range,
      change.text,
      change.rangeOffset,
      change.rangeLength
    );
  }
}

class Edit {
  public readonly file: string;
  public readonly time: Date;
  public readonly baseTime: Date; // reference to concrete checkpoint
  public readonly changes: ContentChange[];

  constructor(
    file: string,
    changes: ContentChange[],
    time: Date,
    baseTime: Date
  ) {
    this.file = file;
    this.changes = changes;
    this.time = time;
    this.baseTime = baseTime;
  }

  save(p: string): void {
    const parent = path.dirname(p);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(this.toJson()));
  }

  toJson(): any {
    return {
      file: this.file,
      time: this.time.getTime(),
      baseTime: this.baseTime.getTime(),
      changes: this.changes.map((c) => c.toJson()),
    };
  }

  static fromJson(json: any): Edit {
    return new Edit(
      json.file,
      json.changes.map(ContentChange.fromJson),
      new Date(json.time),
      new Date(json.baseTime)
    );
  }

  static fromChange(
    change: TextDocumentChangeEvent,
    time: Date,
    baseTime: Date
  ): Edit {
    const fileStr = change.document.uri.path.slice();
    const newEdit = new Edit(
      fileStr,
      change.contentChanges.map(ContentChange.fromChange),
      time,
      baseTime
    );
    return newEdit;
  }
}

function walkDir(
  root: string,
  fileFilter: (file: string) => boolean,
  dirFilter: (dir: string) => boolean
): string[] {
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory()) {
    return [];
  }

  let localChildren = fs
    .readdirSync(root)
    .map((c) => path.join(root, c))
    .sort();

  let allChildren: string[] = [];
  for (let child of localChildren) {
    let childStat = fs.lstatSync(child);
    if (childStat.isDirectory()) {
      if (!dirFilter(child)) {
        continue;
      }
      let decendents = walkDir(child, fileFilter, dirFilter);
      allChildren = allChildren.concat(decendents);
    } else if (fileFilter(child)) {
      allChildren.push(child);
    }
  }
  return allChildren;
}

// TODO: Change to do for Coq as well
function isEssentialDir(dir: string, c: VacuumConfig): boolean {
  const notLakeDir = !dir.endsWith(".lake");
  const notGitDir = !dir.endsWith(".git");
  const notChangesDir = !dir.endsWith(CHANGES_NAME);
  return notLakeDir && notGitDir && notChangesDir;
}

function isEssentialFile(file: string, c: VacuumConfig): boolean {
  return path.basename(file) === "lakefile.toml" || file.endsWith(".lean") || path.basename(file) === "lean-toolchain";
}

/**
 * 
 * @returns true if p2 is a subpath of p1 false otherwise
 */

function isSubpath(p1: string, p2: string) {
  const relpath = path.relative(p1, p2);
  return relpath && !relpath.startsWith("..") && !path.isAbsolute(relpath);
}

// export function getAncestorPaths(): string[] {
//   let workspaceFolders = workspace.workspaceFolders;
//   if (workspaceFolders === undefined || workspaceFolders.length === 0) {
//     return [];
//   }
//   let paths = workspaceFolders.map((folder) => path.resolve(folder.uri.fsPath));
//   let ancestorPaths = [];
//   for (let p of paths) {
//     let hasAncestor = paths
//       .map((parent) => isSubpath(parent, p))
//       .some((x) => x);
//     if (!hasAncestor) {
//       ancestorPaths.push(p);
//     }
//   }
//   return ancestorPaths;
// }


// Need this to see if we need to
// create a new project checkpoint.
// Otherwise, we can just save a new checkpoint
// every n changes.
// Maybe when we encounter a new file?
function rollForward(orig: String, changes: TextDocumentContentChangeEvent[]) { }

/**
 * 
 * @returns The most recent entry in the concrete history for the given document. 
 */
function getLastConcreteCheckpointPath(changePath: string, documentPath: string): string | null {
  const relPath = path.relative(path.dirname(changePath), documentPath);
  const concretePath = path.join(changePath, relPath, CONCRETE_NAME);
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


function createConcreteCheckpoint(
  p: string,
  lastPath: string | null
): ConcreteCheckpoint {
  const newCandidateCheckpoint = NewContentConcreteCheckpoint.fromLeanFile(p);
  if (lastPath === null) {
    return newCandidateCheckpoint;
  }
  const lastCheckpoint = loadLastNewConcreteCheckpoint(lastPath);
  if (lastCheckpoint.contents === newCandidateCheckpoint.contents) {
    return new SameContentConcreteCheckpoint(
      lastCheckpoint.mtime,
      newCandidateCheckpoint.mtime
    );
  }
  return newCandidateCheckpoint;
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

class AsyncLock {
  private last: Promise<void> = Promise.resolve();

  // Acquire lock, run fn, return its result
  acquire(fn: () => Promise<void>): Promise<void> {
    const p = this.last.then(() => fn());
    // Keep the chain alive even if fn rejects
    this.last = p.catch(() => { });
    return p;
  }
}
const logLock = new AsyncLock();


function updateConcreteCheckpointsSync(c: VacuumConfig, wsPath: string) {
  if (wsPath === undefined) {
    return;
  }
  const changePath = path.join(wsPath, CHANGES_NAME);

  const fileFilter = (file: string) => isEssentialFile(file, c);
  const dirFilter = (dir: string) => isEssentialDir(dir, c);
  const files = walkDir(wsPath, fileFilter, dirFilter);
  console.log(`Found ${files.length} files to check for concrete checkpoint updates.`);
  for (let f of files) {
    const fileStat = fs.lstatSync(f);
    const saveLoc = path.join(
      changePath,
      path.relative(wsPath, f),
      CONCRETE_NAME,
      fileStat.mtime.getTime().toString()
    );
    const lastConcretePath = getLastConcreteCheckpointPath(changePath, f);
    if (lastConcretePath === null) {
      // There was no checkpoint beforehand, so we need to save the first one.
      const newConcreteCheckpoint = createConcreteCheckpoint(f, null);
      newConcreteCheckpoint.save(saveLoc);
    } else {
      /* We compare to the previous checkpoint. If the file has been saved since then, 
         we create a new checkpoint */
      const concreteVal = parseInt(path.basename(lastConcretePath), 10);
      const lastConcreteTime = new Date(concreteVal);
      if (lastConcreteTime < fileStat.mtime) {
        console.log("TIMES DIFFER!");
        const newConcreteCheckpoint = createConcreteCheckpoint(
          f,
          lastConcretePath
        );
        newConcreteCheckpoint.save(saveLoc);
      }
    }
  }
}

export async function updateConcreteCheckpoints(
  c: VacuumConfig,
  wsPath: string,
): Promise<void> {
  return logLock.acquire(() =>
    Promise.resolve(updateConcreteCheckpointsSync(c, wsPath))
  );
}

function logChangeSync(
  change: TextDocumentChangeEvent,
  c: VacuumConfig
): void {
  const wsPath = getWorkspacePath(change.document);
  if (wsPath === undefined) {
    return;
  }

  const changePath = path.join(wsPath, CHANGES_NAME);

  console.log("LOGGING CHANGE");
  const time = new Date();
  let lastConcretePath = getLastConcreteCheckpointPath(
    changePath,
    change.document.uri.fsPath
  );

  if (lastConcretePath === null) {
    // This is currently pretty slow
    updateConcreteCheckpointsSync(c, wsPath);
    lastConcretePath = getLastConcreteCheckpointPath(
      changePath,
      change.document.uri.fsPath
    );
  }
  if (lastConcretePath === null) {
    throw new Error(`No concrete checkpoint found for file ${change.document.uri.fsPath}`);
  }

  const lastMTime = new Date(Number(path.basename(lastConcretePath)));

  const newEdit = Edit.fromChange(change, time, lastMTime);
  const relPath = path.relative(path.dirname(changePath), newEdit.file);
  newEdit.save(
    path.join(changePath, relPath, EDITS_NAME, time.getTime().toString())
  );
}

export async function logChange(
  change: TextDocumentChangeEvent,
  c: VacuumConfig
): Promise<void> {
  return logLock.acquire(() => Promise.resolve(logChangeSync(change, c)));
}

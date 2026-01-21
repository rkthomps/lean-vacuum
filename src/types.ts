import path = require("path");
import os = require("os");
import fs = require("fs");

import { Position, Range, TextDocumentChangeEvent, TextDocumentContentChangeEvent } from "vscode";

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


export class NewContentConcreteCheckpoint {
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

export class ContentChange {
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


export class Edit {
    public readonly file: string;
    public readonly time: Date;
    public readonly changes: ContentChange[];

    constructor(
        file: string,
        changes: ContentChange[],
        time: Date,
    ) {
        this.file = file;
        this.changes = changes;
        this.time = time;
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
            changes: this.changes.map((c) => c.toJson()),
        };
    }

    static fromJson(json: any): Edit {
        return new Edit(
            json.file,
            json.changes.map(ContentChange.fromJson),
            new Date(json.time),
        );
    }

    static fromChange(
        change: TextDocumentChangeEvent,
        time: Date,
    ): Edit {
        const fileStr = change.document.uri.path.slice();
        const newEdit = new Edit(
            fileStr,
            change.contentChanges.map(ContentChange.fromChange),
            time,
        );
        return newEdit;
    }
}

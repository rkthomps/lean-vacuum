import * as path from "path";
import fs = require("fs");
import { workspace, ExtensionContext, TextDocumentChangeEvent } from "vscode";
import { exec, execSync } from "child_process";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  NextSignature,
} from "vscode-languageclient/node";

import {
  CHANGES_NAME,
  getAncestorPaths,
  logChange,
  updateConcreteCheckpoints,
  zipChanges,
  upload,
} from "./collection";

import { VacuumConfig, Language, load_config } from "./config";
import { get } from "http";

let client: LanguageClient;

function getLanguageStr(): string {
  const config = load_config();
  switch (config.language) {
    case Language.Lean4:
      return "lean4";
    case Language.Coq:
      return "coq";
  }
}

export function activate(context: ExtensionContext) {
  const disposable = workspace.onDidSaveTextDocument((document) => {
    zipChanges();
    const config = load_config();
    if (config.pushOnSave) {
      upload();
    }
    updateConcreteCheckpoints(config);
  });

  context.subscriptions.push(disposable);

  // The server is implemented in node
  const serverModule = context.asAbsolutePath(
    path.join("server", "out", "server.js")
  );

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
  };

  const customMiddleware = {
    didChange: (e: TextDocumentChangeEvent): Promise<void> => {
      const config = load_config();
      logChange(e, config);
      return new Promise((resolve, reject) => {});
    },
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [
      { scheme: "file", language: "lean4" },
      { scheme: "file", language: "coq" },
    ],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher("**/.clientrc"),
    },
    middleware: customMiddleware,
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    "languageServerExample",
    "Language Server Example",
    serverOptions,
    clientOptions
  );
  // Start the client. This will also launch the server
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

import { workspace } from "vscode";

export enum Language {
}

export type VacuumConfig = {
};

// Currently unused. 
// Scaffolding in case we need to provide configuration.
export function load_config(): VacuumConfig {
  const config = workspace.getConfiguration("lean-vacuum");
  return {  };
}

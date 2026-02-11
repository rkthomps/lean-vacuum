import { workspace } from "vscode";

export type VacuumConfig = {
  participantName?: string | undefined;
  enabled: boolean;
};

// Currently unused. 
// Scaffolding in case we need to provide configuration.
export function load_config(): VacuumConfig {
  const config = workspace.getConfiguration("lean-vacuum");
  return {
    participantName: config.get<string>("participantName"),
    enabled: config.get<boolean>("enabled", true) ?? true
  };
}

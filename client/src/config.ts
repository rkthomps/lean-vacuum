import { workspace } from "vscode";

export enum Language {
  Lean4 = "lean4",
  Coq = "coq",
}

export type VacuumConfig = {
  language: Language;
  pushOnSave: boolean;
};

export function load_config(): VacuumConfig {
  const config = workspace.getConfiguration("lean-vacuum");
  const language = config.get<Language>("language", Language.Lean4);
  const pushOnSave = config.get<boolean>("pushOnSave", false);
  return { language, pushOnSave };
}

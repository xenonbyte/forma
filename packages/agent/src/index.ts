export { formaCoreVersion } from "@xenonbyte/forma-core";

export const formaAgentCommands = [
  "fm-list-product",
  "fm-status",
  "fm-upload-requirement",
  "fm-update-requirement",
  "fm-design",
  "fm-refine-design",
  "fm-refine-components",
  "fm-change-style",
  "fm-rollback-design"
] as const;

export type FormaAgentCommand = (typeof formaAgentCommands)[number];

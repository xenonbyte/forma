export { formaCoreVersion } from "@xenonbyte/forma-core";

export const formaAgentPlatforms = ["claude", "codex", "gemini"] as const;

export type FormaAgentPlatform = (typeof formaAgentPlatforms)[number];

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

export interface FormaAgentPlatformMetadata {
  templateDir: string;
  templateFormat: "markdown-frontmatter" | "toml-prompt" | "codex-skill";
  templateFilePattern: string;
  targetFilePattern: string;
  mcpConfigPath: string;
}

export const formaAgentPlatformMetadata = {
  claude: {
    templateDir: "claude",
    templateFormat: "markdown-frontmatter",
    templateFilePattern: "claude/{command}.md",
    targetFilePattern: "~/.claude/commands/{command}.md",
    mcpConfigPath: "~/.claude/mcp.json"
  },
  codex: {
    templateDir: "codex",
    templateFormat: "codex-skill",
    templateFilePattern: "codex/{command}/SKILL.md",
    targetFilePattern: "~/.codex/prompts/skills/{command}/SKILL.md",
    mcpConfigPath: "~/.codex/config.toml"
  },
  gemini: {
    templateDir: "gemini",
    templateFormat: "toml-prompt",
    templateFilePattern: "gemini/{command}.toml",
    targetFilePattern: "~/.gemini/commands/{command}.toml",
    mcpConfigPath: "~/.gemini/settings.json"
  }
} as const satisfies Record<FormaAgentPlatform, FormaAgentPlatformMetadata>;

import { access, cp, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { FormaError } from "./errors.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

const styleVariablesSchema = z.object({
  primary: z.string(),
  background: z.string(),
  "text-primary": z.string(),
  "font-heading": z.string(),
  "font-body": z.string(),
  "border-radius": z.string(),
  "spacing-unit": z.string()
});

const styleMetadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  design_md_path: z.string().min(1),
  variables: styleVariablesSchema
});

const stylesIndexSchema = z.object({
  styles: z.array(styleMetadataSchema)
});

export type StyleVariables = z.infer<typeof styleVariablesSchema>;
export type StyleMetadata = z.infer<typeof styleMetadataSchema>;

export interface StyleServiceOptions {
  home: string;
}

const defaultVariables: StyleVariables = {
  primary: "#111827",
  background: "#FFFFFF",
  "text-primary": "#111827",
  "font-heading": "Inter",
  "font-body": "Inter",
  "border-radius": "8px",
  "spacing-unit": "8px"
};

export class StyleService {
  private readonly home: string;
  private readonly stylesDir: string;
  private readonly stylesIndexFile: string;

  constructor(options: StyleServiceOptions) {
    this.home = options.home;
    this.stylesDir = join(options.home, "styles");
    this.stylesIndexFile = join(this.stylesDir, "styles.yaml");
  }

  async installBuiltInStyles(): Promise<StyleMetadata[]> {
    const bundledStylesDir = await findBundledStylesDir();
    await mkdir(this.stylesDir, { recursive: true });
    await cp(bundledStylesDir, this.stylesDir, { recursive: true });

    const metadata = await readYamlAs(this.stylesIndexFile, stylesIndexSchema);
    await writeYamlAtomic(this.stylesIndexFile, metadata);
    return metadata.styles;
  }

  async listStyles(): Promise<StyleMetadata[]> {
    return (await readYamlAs(this.stylesIndexFile, stylesIndexSchema)).styles;
  }

  async getStyle(name: string): Promise<{ metadata: StyleMetadata; designMd: string }> {
    const metadata = (await this.listStyles()).find((style) => style.name === name);
    if (!metadata) {
      throw new FormaError("STYLE_NOT_FOUND", "Style not found", { style: name });
    }

    const designMd = await readFile(join(this.home, metadata.design_md_path), "utf8");
    return { metadata, designMd };
  }

  withDefaultVariables(partial: Partial<StyleVariables>): StyleVariables {
    return styleVariablesSchema.parse({ ...defaultVariables, ...partial });
  }
}

async function findBundledStylesDir(): Promise<string> {
  const candidates = [
    resolve(process.cwd(), "styles"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../styles"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../styles")
  ];

  for (const candidate of candidates) {
    if (await fileExists(join(candidate, "styles.yaml"))) {
      return candidate;
    }
  }

  throw new FormaError("STYLE_NOT_FOUND", "Built-in styles not found", { candidates });
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

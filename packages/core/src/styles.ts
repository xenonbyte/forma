import { randomBytes } from "node:crypto";
import { access, cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { z } from "zod";
import { FormaError } from "./errors.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const styleVariablesSchema = z.object({
  primary: z.string(),
  background: z.string(),
  "text-primary": z.string(),
  "font-heading": z.string(),
  "font-body": z.string(),
  "border-radius": z.string(),
  "spacing-unit": z.string()
});

export const styleDesignPathSchema = z.string().min(1).refine(isSafeStyleDesignPath, {
  message: "design_md_path must be a relative path under styles/"
});

export const styleMetadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  design_md_path: styleDesignPathSchema,
  variables: styleVariablesSchema
});

export const stylesIndexSchema = z.object({
  last_synced: z.string().optional(),
  styles: z.array(styleMetadataSchema)
});

export type StyleVariables = z.infer<typeof styleVariablesSchema>;
export type StyleMetadata = z.infer<typeof styleMetadataSchema>;

export interface StyleServiceOptions {
  home: string;
  bundledStylesDir?: string;
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
  private readonly bundledStylesDir: string;

  constructor(options: StyleServiceOptions) {
    this.home = options.home;
    this.stylesDir = join(options.home, "styles");
    this.stylesIndexFile = join(this.stylesDir, "styles.yaml");
    this.bundledStylesDir = options.bundledStylesDir ?? getDefaultBundledStylesDir();
  }

  async installBuiltInStyles(): Promise<StyleMetadata[]> {
    const tempStylesDir = `${this.stylesDir}.tmp-${randomBytes(8).toString("hex")}`;
    try {
      await cp(this.bundledStylesDir, tempStylesDir, { recursive: true });
      const metadata = await readYamlAs(join(tempStylesDir, "styles.yaml"), stylesIndexSchema);

      if (await fileExists(this.stylesDir)) {
        await rm(tempStylesDir, { recursive: true, force: true });
        return this.listStyles();
      }

      await mkdir(dirname(this.stylesDir), { recursive: true });
      await rename(tempStylesDir, this.stylesDir);
      await writeYamlAtomic(this.stylesIndexFile, metadata);
      return metadata.styles;
    } catch (error) {
      await rm(tempStylesDir, { recursive: true, force: true });
      throw error;
    }
  }

  async listStyles(): Promise<StyleMetadata[]> {
    if (!(await fileExists(this.stylesIndexFile))) {
      return this.installBuiltInStyles();
    }
    return (await readYamlAs(this.stylesIndexFile, stylesIndexSchema)).styles;
  }

  async getStyle(name: string): Promise<{ metadata: StyleMetadata; designMd: string }> {
    const metadata = (await this.listStyles()).find((style) => style.name === name);
    if (!metadata) {
      throw new FormaError("INVALID_INPUT", "Style not found", { style: name });
    }

    const designMd = await readFile(this.safeHomeStylePath(metadata.design_md_path), "utf8");
    return { metadata, designMd };
  }

  withDefaultVariables(partial: Partial<StyleVariables>): StyleVariables {
    return styleVariablesSchema.parse({ ...defaultVariables, ...partial });
  }

  private safeHomeStylePath(relativePath: string): string {
    const safeRelativePath = styleDesignPathSchema.parse(relativePath);
    const stylesRoot = resolve(this.home, "styles");
    const file = resolve(this.home, safeRelativePath);
    if (file !== stylesRoot && !file.startsWith(`${stylesRoot}${sep}`)) {
      throw new FormaError("INVALID_INPUT", "Style path is outside styles directory", {
        design_md_path: relativePath
      });
    }

    return file;
  }
}

function getDefaultBundledStylesDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../styles");
}

function isSafeStyleDesignPath(value: string): boolean {
  if (isAbsolute(value) || posix.isAbsolute(value) || !value.startsWith("styles/")) {
    return false;
  }

  const segments = value.split("/");
  return !segments.includes("..") && posix.normalize(value) === value;
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

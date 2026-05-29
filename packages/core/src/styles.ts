import { randomBytes } from "node:crypto";
import { access, cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { z } from "zod";
import { FormaError } from "./errors.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const styleDesignPathSchema = z.string().min(1).refine(isSafeStyleDesignPath, {
  message: "design_md_path must be a relative path under styles/"
});

export const styleMetadataSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional(),
  upstream: z.string().optional(),
  design_md_path: styleDesignPathSchema,
  tokens_css_path: z.string().min(1),
  components_html_path: z.string().min(1),
}).strict();

export const systemStyleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  mode: z.literal('design-system'),
  category: z.string().optional(),
  upstream: z.string().optional(),
}).strict();

export const stylesIndexSchema = z.object({
  last_synced: z.string().optional(),
  styles: z.array(styleMetadataSchema),
});

export const systemStylesIndexSchema = z.object({
  systems: z.array(systemStyleSchema),
});

export type StyleMetadata = z.infer<typeof styleMetadataSchema>;
export type SystemStyleMetadata = z.infer<typeof systemStyleSchema>;

export interface BrandStyleContent {
  kind: 'brand';
  metadata: StyleMetadata;
  designMd: string;
  tokensCss: string;
  componentsHtml: string;
}

export interface StyleServiceOptions {
  home: string;
  bundledStylesDir?: string;
  bundledCraftDir?: string;
}

export interface CraftDoc { slug: string; content: string; }

export class StyleService {
  private readonly home: string;
  private readonly stylesDir: string;
  private readonly stylesIndexFile: string;
  private readonly bundledStylesDir: string;
  private readonly bundledCraftDir: string;

  constructor(options: StyleServiceOptions) {
    this.home = options.home;
    this.stylesDir = join(options.home, "styles");
    this.stylesIndexFile = join(this.stylesDir, "styles.yaml");
    this.bundledStylesDir = options.bundledStylesDir ?? getDefaultBundledStylesDir();
    this.bundledCraftDir = options.bundledCraftDir ?? getDefaultBundledCraftDir();
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

  async getStyle(name: string): Promise<BrandStyleContent> {
    const metadata = (await this.listStyles()).find((s) => s.name === name);
    if (!metadata) throw new FormaError('INVALID_INPUT', 'Style not found', { style: name });
    const [designMd, tokensCss, componentsHtml] = await Promise.all([
      readFile(this.safeHomeStylePath(metadata.design_md_path), 'utf8'),
      readFile(this.safeHomeStylePath(metadata.tokens_css_path), 'utf8'),
      readFile(this.safeHomeStylePath(metadata.components_html_path), 'utf8'),
    ]);
    return { kind: 'brand', metadata, designMd, tokensCss, componentsHtml };
  }

  async listSystemStyles(): Promise<SystemStyleMetadata[]> {
    const file = join(this.stylesDir, '_system', 'system-styles.yaml');
    if (!(await fileExists(file))) {
      // 首装/未拷贝时从 bundled 读取
      return (await readYamlAs(join(this.bundledStylesDir, '_system', 'system-styles.yaml'), systemStylesIndexSchema)).systems;
    }
    return (await readYamlAs(file, systemStylesIndexSchema)).systems;
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

  async listCraftDocs(): Promise<CraftDoc[]> {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(this.bundledCraftDir);
    const slugs = entries
      .filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'ATTRIBUTION.md')
      .map((f) => f.replace(/\.md$/, ''));
    return Promise.all(slugs.map((slug) => this.readCraftDoc(slug)));
  }

  async readCraftDoc(slug: string): Promise<CraftDoc> {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new FormaError('INVALID_INPUT', 'Invalid craft slug', { slug });
    }
    const file = join(this.bundledCraftDir, `${slug}.md`);
    try {
      return { slug, content: await readFile(file, 'utf8') };
    } catch {
      throw new FormaError('INVALID_INPUT', 'Craft doc not found', { slug });
    }
  }
}

function getDefaultBundledStylesDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../styles");
}

function getDefaultBundledCraftDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../craft");
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

import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { productIdSchema } from "./product.js";
import {
  defaultProductMutationWarningSink,
  getProductMutationLock,
  runProductMutationWithWarnings,
  type ProductMutationContext,
  type ProductMutationLock,
} from "./product-mutation-lock.js";
import { requirementIdSchema } from "./requirement.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const copyItemSchema = z
  .object({
    context: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();

export const translationEntrySchema = z
  .object({
    context: z.string().min(1),
    texts: z.record(z.string(), z.string()),
    outdated: z.boolean().optional(),
  })
  .strict();

export const pageTranslationSchema = z
  .object({
    page_id: z.string().min(1),
    entries: z.array(translationEntrySchema),
  })
  .strict();

const translationsDocumentSchema = z
  .object({
    translations: z.array(pageTranslationSchema),
  })
  .strict();

export type CopyItem = z.infer<typeof copyItemSchema>;
export type TranslationEntry = z.infer<typeof translationEntrySchema>;
export type PageTranslation = z.infer<typeof pageTranslationSchema>;

export interface CopyServiceOptions {
  home: string;
  productMutationLock?: ProductMutationLock;
  onProductMutationWarning?: (warning: string) => void;
}

export type CopyByPage = Record<string, CopyItem[]>;

export class CopyService {
  private readonly dataDir: string;
  private readonly productMutationLock: ProductMutationLock;
  private readonly onProductMutationWarning: (warning: string) => void;

  constructor(options: CopyServiceOptions) {
    this.dataDir = join(options.home, "data");
    this.productMutationLock = options.productMutationLock ?? getProductMutationLock(options.home);
    this.onProductMutationWarning = options.onProductMutationWarning ?? defaultProductMutationWarningSink;
  }

  async getTranslations(productId: string, requirementId: string): Promise<PageTranslation[]> {
    const file = this.translationsFile(productId, requirementId);
    if (!(await fileExists(file))) {
      return [];
    }

    return normalizeTranslations((await readYamlAs(file, translationsDocumentSchema)).translations);
  }

  async saveTranslations(productId: string, requirementId: string, translations: PageTranslation[]): Promise<void> {
    return this.runProductMutation({ operation: "save_translations", product_id: productId }, async () =>
      this.saveTranslationsLocked(productId, requirementId, translations),
    );
  }

  async saveTranslationsLocked(
    productId: string,
    requirementId: string,
    translations: PageTranslation[],
  ): Promise<void> {
    const file = this.translationsFile(productId, requirementId);
    const parsed = normalizeTranslations(translations);
    if (parsed.length === 0) {
      await rm(file, { force: true });
      return;
    }

    await writeYamlAtomic(file, { translations: parsed });
  }

  async updatePageTranslations(
    productId: string,
    requirementId: string,
    pageId: string,
    translations: TranslationEntry[],
  ): Promise<void> {
    return this.runProductMutation({ operation: "update_page_translations", product_id: productId }, async () =>
      this.updatePageTranslationsLocked(productId, requirementId, pageId, translations),
    );
  }

  async updatePageTranslationsLocked(
    productId: string,
    requirementId: string,
    pageId: string,
    translations: TranslationEntry[],
  ): Promise<void> {
    const current = await this.getTranslations(productId, requirementId);
    const pagesById = new Map(current.map((page) => [page.page_id, page]));
    const currentPage = pagesById.get(pageId);
    const entriesByContext = new Map(currentPage?.entries.map((entry) => [entry.context, entry]) ?? []);

    for (const entry of translations) {
      const existing = entriesByContext.get(entry.context);
      entriesByContext.set(
        entry.context,
        clearOutdated({
          ...entry,
          texts: { ...(existing?.texts ?? {}), ...entry.texts },
        }),
      );
    }

    pagesById.set(pageId, {
      page_id: pageId,
      entries: [...entriesByContext.values()],
    });

    const next = normalizeTranslations([...pagesById.values()]);
    await this.saveTranslationsLocked(productId, requirementId, next);
  }

  async mergeTranslations(
    productId: string,
    requirementId: string,
    oldCopy: CopyByPage,
    newCopy: CopyByPage,
    newTranslations: PageTranslation[],
  ): Promise<PageTranslation[]> {
    return this.runProductMutation({ operation: "merge_translations", product_id: productId }, async () =>
      this.mergeTranslationsLocked(productId, requirementId, oldCopy, newCopy, newTranslations),
    );
  }

  async mergeTranslationsLocked(
    productId: string,
    requirementId: string,
    oldCopy: CopyByPage,
    newCopy: CopyByPage,
    newTranslations: PageTranslation[],
  ): Promise<PageTranslation[]> {
    const freshKeys = new Set<string>();
    const pagesById = new Map(
      (await this.getTranslations(productId, requirementId)).map((page) => [page.page_id, page]),
    );

    for (const page of newTranslations) {
      const current = pagesById.get(page.page_id);
      const entriesByContext = new Map(current?.entries.map((entry) => [entry.context, entry]) ?? []);
      for (const entry of page.entries) {
        freshKeys.add(translationKey(page.page_id, entry.context));
        entriesByContext.set(entry.context, clearOutdated(entry));
      }
      pagesById.set(page.page_id, { page_id: page.page_id, entries: [...entriesByContext.values()] });
    }

    const pageIds = new Set([...pagesById.keys(), ...Object.keys(oldCopy), ...Object.keys(newCopy)]);
    for (const pageId of pageIds) {
      const page = pagesById.get(pageId);
      if (!page) {
        continue;
      }

      const oldTextByContext = copyTextByContext(oldCopy[pageId] ?? []);
      const newTextByContext = copyTextByContext(newCopy[pageId] ?? []);
      pagesById.set(pageId, {
        page_id: page.page_id,
        entries: page.entries.map((entry) => {
          if (freshKeys.has(translationKey(page.page_id, entry.context))) {
            return clearOutdated(entry);
          }

          const oldText = oldTextByContext.get(entry.context);
          const newText = newTextByContext.get(entry.context);
          const sourceTextChanged = oldText !== undefined && newText !== undefined && oldText !== newText;
          const sourceContextReintroduced = oldText === undefined && newText !== undefined;
          if (sourceTextChanged || sourceContextReintroduced) {
            return { ...entry, outdated: true };
          }

          return entry;
        }),
      });
    }

    return normalizeTranslations([...pagesById.values()]);
  }

  private translationsFile(productId: string, requirementId: string): string {
    return join(
      this.dataDir,
      productIdSchema.parse(productId),
      requirementIdSchema.parse(requirementId),
      "copy-translations.yaml",
    );
  }

  private async runProductMutation<T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>,
  ): Promise<T> {
    return runProductMutationWithWarnings(this.productMutationLock, input, fn, this.onProductMutationWarning);
  }
}

function normalizeTranslations(translations: PageTranslation[]): PageTranslation[] {
  return translations
    .map((page) =>
      pageTranslationSchema.parse({
        page_id: page.page_id,
        entries: page.entries.map((entry) => translationEntrySchema.parse(entry)).sort(compareContext),
      }),
    )
    .filter((page) => page.entries.length > 0)
    .sort(comparePageId);
}

function clearOutdated(entry: TranslationEntry): TranslationEntry {
  const next = { ...translationEntrySchema.parse(entry) };
  delete next.outdated;
  return next;
}

function copyTextByContext(items: CopyItem[]): Map<string, string> {
  return new Map(
    items.map((item) => {
      const parsed = copyItemSchema.parse(item);
      return [parsed.context, parsed.text];
    }),
  );
}

function translationKey(pageId: string, context: string): string {
  return `${pageId}\0${context}`;
}

function comparePageId(a: PageTranslation, b: PageTranslation): number {
  return a.page_id.localeCompare(b.page_id);
}

function compareContext(a: TranslationEntry, b: TranslationEntry): number {
  return a.context.localeCompare(b.context);
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

import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { getArtifactsDir, getArtifactVersionDir } from './artifact-paths.js';
import { getFormaPaths } from './paths.js';
import { normalizeKind, validateArtifactManifest, type ArtifactManifest } from './artifact-manifest.js';
import { ProductService } from './product.js';
import { getProductMutationLock, type ProductMutationLock } from './product-mutation-lock.js';

export interface BackfillOptions { home: string; productMutationLock?: ProductMutationLock; }
export interface BackfillReport { migrated: number; skipped: number; recovered: number; notes: string[]; }

/**
 * 幂等补齐：把旧扁平 artifact（manifest.json 在 artifacts/{id}/）迁为版本化 v1/，
 * kind 归一（html→design-page / design-system→component-library），
 * 补 forma.variant=default + forma.requirementId（若有），并建当前版本指针。
 * 已是 v{n} 布局的（含 forma）视为已迁移，跳过。
 * 崩溃恢复：先写 v1 临时目录并原子 rename；若重跑时发现 v1 已存在但 flat manifest 仍在，
 * 校验 v1 manifest、补指针、清理 flat 遗留后标记 recovered。
 *
 * ⚠️ 顺序约束（必读）：本函数会**删除旧 flat `artifacts/{id}/manifest.json`**。在 server/MCP 的
 * listArtifacts/readArtifact/export 读取面**改为 version-aware（P4.8/P4.10）之前不要运行**，否则已迁移的
 * artifact 会从旧读取面消失并 404。本函数为**手动一次性脚本**、不被任何启动路径自动调用——
 * 必须在读取面升级后再显式触发。
 */
export async function backfillDesignArtifacts(options: BackfillOptions): Promise<BackfillReport> {
  const report: BackfillReport = { migrated: 0, skipped: 0, recovered: 0, notes: [] };
  const lock = options.productMutationLock ?? getProductMutationLock(options.home);
  const products = new ProductService({ home: options.home, productMutationLock: lock });
  return lock.run({ operation: 'backfill_design_artifacts' }, async () => {
    await backfillDesignArtifactsLocked(options.home, products, report);
    return report;
  });
}

async function backfillDesignArtifactsLocked(home: string, products: ProductService, report: BackfillReport): Promise<void> {
  const productsRoot = getFormaPaths(home).productsDir; // = home/data/products

  let productIds: string[];
  try {
    productIds = (await readdir(productsRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^P-[a-f0-9]{6}$/.test(e.name)).map((e) => e.name);
  } catch { return; }

  for (const productId of productIds) {
    const artifactsDir = getArtifactsDir(productsRoot, productId);
    let artifactIds: string[];
    try {
      artifactIds = (await readdir(artifactsDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith('.tmp-')).map((e) => e.name);
    } catch { continue; }

    for (const artifactId of artifactIds) {
      const flatManifest = join(artifactsDir, artifactId, 'manifest.json');
      const versionDir = getArtifactVersionDir(productsRoot, productId, artifactId, 1);
      const isFlat = await fileExists(flatManifest);
      if (!isFlat) {
        // 崩溃恢复窗口：v1 已写入、flat manifest 已删除，但指针可能还没写。
        const recovered = await recoverExistingV1(products, productId, artifactId, versionDir, report);
        if (recovered === 'missing') report.skipped += 1;
        continue;
      }
      if (await dirExists(versionDir)) {
        // flat manifest 仍在但 v1 已存在：先确认 v1 有效并补指针，再清理 flat 遗留。
        const recovered = await recoverExistingV1(products, productId, artifactId, versionDir, report);
        if (recovered === 'handled') await cleanupFlatLegacyAfterVersionExists(join(artifactsDir, artifactId));
        continue;
      }

      const legacy = JSON.parse(await readFile(flatManifest, 'utf8')) as ArtifactManifest & { requirementId?: string };
      const newKind = normalizeKind(legacy.kind);
      const requirementId = legacy.requirementId;
      const isDesignPage = newKind === 'design-page';
      const pageId = requirementId ?? artifactId; // best-effort（见 plan 现实增量 #6）
      if (isDesignPage && legacy.forma?.pageId === undefined) {
        report.notes.push(`inferred pageId for ${artifactId}: ${pageId}`);
      }

      const migrated: ArtifactManifest = {
        ...legacy,
        kind: newKind,
        forma: {
          ...(legacy.forma ?? {}),
          ...(isDesignPage ? { requirementId, pageId, variant: legacy.forma?.variant ?? 'default' } : {}),
        },
      };
      const validation = validateArtifactManifest(migrated);
      if (!validation.ok) { report.notes.push(`skip ${artifactId}: ${validation.error}`); report.skipped += 1; continue; }

      // 先 copy 到 v1 临时目录，再原子 rename 到 v1；成功后清理旧 flat 文件
      await moveLegacyDirIntoV1(join(artifactsDir, artifactId), versionDir, migrated);
      report.migrated += 1;
      await maybeSetPointer(products, productId, artifactId, migrated);
    }
  }
}

type RecoverExistingV1Result = 'missing' | 'invalid' | 'handled';

async function recoverExistingV1(
  products: ProductService,
  productId: string,
  artifactId: string,
  versionDir: string,
  report: BackfillReport,
): Promise<RecoverExistingV1Result> {
  if (!(await dirExists(versionDir))) return 'missing';
  const existing = JSON.parse(await readFile(join(versionDir, 'manifest.json'), 'utf8')) as ArtifactManifest;
  const validation = validateArtifactManifest(existing);
  if (!validation.ok) { report.notes.push(`blocked ${artifactId}: existing v1 invalid: ${validation.error}`); report.skipped += 1; return 'invalid'; }
  const pointerWritten = await maybeSetPointer(products, productId, artifactId, existing);
  if (pointerWritten) report.recovered += 1;
  else report.skipped += 1;
  return 'handled';
}

async function moveLegacyDirIntoV1(artifactDir: string, versionDir: string, migratedManifest: ArtifactManifest): Promise<void> {
  const tmpVersionDir = `${versionDir}.tmp-${randomBytes(4).toString('hex')}`;
  await rm(tmpVersionDir, { recursive: true, force: true });
  await mkdir(tmpVersionDir, { recursive: true });
  for (const entry of await readdir(artifactDir, { withFileTypes: true })) {
    if (entry.name === 'manifest.json') continue;                 // 重写后写新 manifest
    if (/^v\d+($|\.tmp-)/.test(entry.name)) continue;              // 已有版本/临时版本目录不复制
    await cp(join(artifactDir, entry.name), join(tmpVersionDir, entry.name), { recursive: true });
  }
  await writeFile(join(tmpVersionDir, 'manifest.json'), JSON.stringify(migratedManifest, null, 2), 'utf8');
  await rename(tmpVersionDir, versionDir);
  await cleanupFlatLegacyAfterVersionExists(artifactDir);
}

async function cleanupFlatLegacyAfterVersionExists(artifactDir: string): Promise<void> {
  await rm(join(artifactDir, 'manifest.json'), { force: true });
  for (const entry of await readdir(artifactDir, { withFileTypes: true })) {
    if (/^v\d+$/.test(entry.name)) continue;
    await rm(join(artifactDir, entry.name), { recursive: true, force: true });
  }
}

async function maybeSetPointer(products: ProductService, productId: string, artifactId: string, manifest: ArtifactManifest): Promise<boolean> {
  if (manifest.kind !== 'design-page' || !manifest.forma?.requirementId || !manifest.forma.pageId || !manifest.forma.variant) return false;
  const current = await products.getDesignPointer(productId, manifest.forma.requirementId, manifest.forma.pageId, manifest.forma.variant);
  if (current?.artifactId === artifactId && current.version === 1 && current.designStatus === 'active') return false;
  await products.setDesignPointerLocked(productId, {
    requirementId: manifest.forma.requirementId,
    pageId: manifest.forma.pageId,
    variant: manifest.forma.variant,
    artifactId,
    version: 1,
    designStatus: 'active',
  });
  return true;
}

async function fileExists(file: string): Promise<boolean> {
  try { await stat(file); return true; } catch { return false; }
}
async function dirExists(dir: string): Promise<boolean> {
  try { return (await stat(dir)).isDirectory(); } catch { return false; }
}

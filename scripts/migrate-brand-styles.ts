import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dump } from "js-yaml";

const UPSTREAM = "/Users/xubo/x-studio/forma2-cankao/open-design/design-systems";
const REPO_STYLES = resolve("styles");

interface BrandEntry {
  name: string;
  description: string;
  category?: string;
  upstream?: string;
  design_md_path: string;
  tokens_css_path: string;
  components_html_path: string;
}

async function main() {
  await assertRequiredUpstreamFiles();
  const names = (await readdir(UPSTREAM, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name !== "_schema")
    .map((e) => e.name);

  // 清理旧 brand 目录（保留 LICENSE / _system 等非 brand 资源由后续任务管理）
  for (const e of await readdir(REPO_STYLES, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== "_system") await rm(join(REPO_STYLES, e.name), { recursive: true, force: true });
  }

  const entries: BrandEntry[] = [];
  for (const name of names) {
    const src = join(UPSTREAM, name);
    const files = await readdir(src);
    if (!files.includes("DESIGN.md")) continue; // 只取真正的 brand 风格
    const dst = join(REPO_STYLES, name);
    await mkdir(dst, { recursive: true });
    for (const f of ["DESIGN.md", "tokens.css", "components.html"]) {
      if (!files.includes(f)) throw new Error(`Brand style ${name} missing required ${f}`);
      await cp(join(src, f), join(dst, f));
    }
    const description = await firstParagraph(join(dst, "DESIGN.md"));
    entries.push({
      name,
      description,
      design_md_path: `styles/${name}/DESIGN.md`,
      tokens_css_path: `styles/${name}/tokens.css`,
      components_html_path: `styles/${name}/components.html`,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(join(REPO_STYLES, "styles.yaml"), dump({ styles: entries }), "utf8");
  // eslint-disable-next-line no-console
  console.log(`migrated ${entries.length} brand styles`);
}

async function firstParagraph(designMd: string): Promise<string> {
  const text = await readFile(designMd, "utf8");
  const quote = text.split("\n").find((l) => l.trim().startsWith(">"));
  return (quote ? quote.replace(/^>\s*/, "") : "Brand design system").slice(0, 200);
}

async function assertRequiredUpstreamFiles() {
  const root = "/Users/xubo/x-studio/forma2-cankao/open-design";
  await readFile(join(root, "design-systems", "README.md"), "utf8");
  await readFile(join(root, "LICENSE"), "utf8");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

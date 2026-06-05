import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dump, load } from "js-yaml";

const SKILLS = "/Users/xubo/x-studio/forma2-cankao/open-design/skills";
const OUT = resolve("styles/_system");

interface SystemStub {
  name: string;
  description: string;
  mode: "design-system";
  category?: string;
  upstream?: string;
}

interface Frontmatter {
  description?: unknown;
  od?: { mode?: unknown; category?: unknown; upstream?: unknown };
}

// frontmatter 本身是 YAML，直接用 js-yaml 解析（正确处理 `description: |` 块标量等）。
function parseFrontmatter(md: string): Frontmatter | undefined {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!m) return undefined;
  try {
    const doc = load(m[1]);
    return doc && typeof doc === "object" ? (doc as Frontmatter) : undefined;
  } catch {
    return undefined;
  }
}

function oneLine(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function main() {
  const names = (await readdir(SKILLS, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  const systems: SystemStub[] = [];
  for (const name of names) {
    let md: string;
    try {
      md = await readFile(join(SKILLS, name, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(md);
    if (fm?.od?.mode !== "design-system") continue;
    systems.push({
      name,
      description: oneLine(fm.description, name),
      mode: "design-system",
      ...(typeof fm.od.category === "string" ? { category: fm.od.category } : {}),
      ...(typeof fm.od.upstream === "string" ? { upstream: fm.od.upstream } : {}),
    });
  }
  systems.sort((a, b) => a.name.localeCompare(b.name));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "system-styles.yaml"), dump({ systems }), "utf8");
  // eslint-disable-next-line no-console
  console.log(`migrated ${systems.length} system-style stubs`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

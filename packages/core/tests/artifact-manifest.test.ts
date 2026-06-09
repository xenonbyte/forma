import { describe, it, expect } from "vitest";
import {
  validateArtifactManifest,
  validateSupportingPath,
  ALLOWED_KINDS,
  normalizeKind,
  validateFormaExtension,
  normalizeFormaExtension,
} from "../src/artifact-manifest.js";

// 合法的最小 manifest
const validManifest = {
  version: 1,
  id: "AbCdEfGhIjKlMnOp",
  kind: "html",
  renderer: "html",
  title: "Test Artifact",
  entry: "index.html",
  status: "complete",
  exports: ["index.html"],
  createdAt: "2026-05-28T00:00:00.000Z",
  updatedAt: "2026-05-28T00:00:00.000Z",
};

describe("validateArtifactManifest", () => {
  // 1. 合法 manifest 通过
  it("accepts a valid manifest", () => {
    const result = validateArtifactManifest(validManifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("AbCdEfGhIjKlMnOp");
      expect(result.value.kind).toBe("html");
    }
  });

  // 2. manifest.id 缺失 → 失败
  it("rejects manifest missing id", () => {
    const { id: _id, ...noId } = validManifest;
    const result = validateArtifactManifest(noId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/id/i);
    }
  });

  // 3. manifest.id 格式错误（非 16 位字母数字）→ 失败
  it("rejects manifest with bad id format (too short)", () => {
    const result = validateArtifactManifest({ ...validManifest, id: "short" });
    expect(result.ok).toBe(false);
  });

  it("rejects manifest with bad id format (contains hyphen)", () => {
    const result = validateArtifactManifest({ ...validManifest, id: "AbCd-fGhIjKlMnOp" });
    expect(result.ok).toBe(false);
  });

  it("rejects manifest with bad id format (17 chars)", () => {
    const result = validateArtifactManifest({ ...validManifest, id: "AbCdEfGhIjKlMnOpQ" });
    expect(result.ok).toBe(false);
  });

  // 4. manifest.kind 不在 ALLOWED_KINDS → 失败
  it("rejects unknown kind", () => {
    const result = validateArtifactManifest({ ...validManifest, kind: "unknown-kind" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/kind/i);
    }
  });

  // 5. manifest.kind = 'react-component' → 失败（SPEC-PLAN-015 移除决策）
  it("rejects react-component kind (removed per SPEC-PLAN-015)", () => {
    const result = validateArtifactManifest({ ...validManifest, kind: "react-component", renderer: "html" });
    expect(result.ok).toBe(false);
  });

  // 6. manifest.renderer 不在 ALLOWED_RENDERERS → 失败
  it("rejects unknown renderer", () => {
    const result = validateArtifactManifest({ ...validManifest, renderer: "react" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/renderer/i);
    }
  });

  it("rejects entry paths that escape the artifact directory", () => {
    const result = validateArtifactManifest({ ...validManifest, entry: "../outside.html" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/entry/i);
    }
  });

  // 12. requirementId 合法（string ≤128 字节）→ 通过
  it("accepts valid requirementId", () => {
    const result = validateArtifactManifest({ ...validManifest, requirementId: "R-abc12345" });
    expect(result.ok).toBe(true);
  });

  it("accepts manifest without requirementId (optional)", () => {
    const result = validateArtifactManifest(validManifest);
    expect(result.ok).toBe(true);
  });

  // 13. requirementId 过长 → 失败
  it("rejects requirementId exceeding 128 bytes", () => {
    const longId = "x".repeat(129);
    const result = validateArtifactManifest({ ...validManifest, requirementId: longId });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/requirementId/i);
    }
  });

  // 14. title 超长（>200）→ 失败
  it("rejects title longer than 200 characters", () => {
    const result = validateArtifactManifest({ ...validManifest, title: "a".repeat(201) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/title/i);
    }
  });

  // 15. exports 必须是非空数组 → 空 exports 失败
  it("rejects empty exports array", () => {
    const result = validateArtifactManifest({ ...validManifest, exports: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exports/i);
    }
  });

  it("rejects non-array exports", () => {
    const result = validateArtifactManifest({ ...validManifest, exports: "index.html" });
    expect(result.ok).toBe(false);
  });

  // metadata 超 16KB → 失败
  it("rejects metadata exceeding 16KB", () => {
    const bigString = "x".repeat(16 * 1024 + 1);
    const result = validateArtifactManifest({ ...validManifest, metadata: { big: bigString } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/metadata/i);
    }
  });

  // 支持所有 ALLOWED_KINDS
  it("accepts design-system kind", () => {
    const result = validateArtifactManifest({ ...validManifest, kind: "design-system", renderer: "design-system" });
    expect(result.ok).toBe(true);
  });

  it("accepts markdown-document kind", () => {
    const result = validateArtifactManifest({ ...validManifest, kind: "markdown-document", renderer: "markdown" });
    expect(result.ok).toBe(true);
  });

  it("accepts svg kind", () => {
    const result = validateArtifactManifest({ ...validManifest, kind: "svg", renderer: "svg" });
    expect(result.ok).toBe(true);
  });

  it("accepts image kind", () => {
    const result = validateArtifactManifest({ ...validManifest, kind: "image", renderer: "image" });
    expect(result.ok).toBe(true);
  });

  it("accepts preview-only kind", () => {
    const result = validateArtifactManifest({ ...validManifest, kind: "preview-only", renderer: "preview-only" });
    expect(result.ok).toBe(true);
  });
});

describe("validateSupportingPath", () => {
  // 合法路径
  it("accepts simple relative path", () => {
    expect(validateSupportingPath("styles/main.css")).toBe("styles/main.css");
  });

  it("accepts filename in root", () => {
    expect(validateSupportingPath("index.html")).toBe("index.html");
  });

  // 7. path traversal → 失败
  it("rejects path traversal (../../etc/passwd)", () => {
    expect(validateSupportingPath("../../etc/passwd")).toBeNull();
  });

  it("rejects path traversal (../secret)", () => {
    expect(validateSupportingPath("../secret")).toBeNull();
  });

  // 8. 绝对路径 → 失败
  it("rejects absolute path (/etc/passwd)", () => {
    expect(validateSupportingPath("/etc/passwd")).toBeNull();
  });

  // 9. null byte → 失败
  it("rejects path with null byte", () => {
    expect(validateSupportingPath("foo\x00bar")).toBeNull();
  });

  // 10. Windows 驱动器前缀 → 失败
  it("rejects Windows drive prefix (C:\\Windows)", () => {
    expect(validateSupportingPath("C:\\Windows")).toBeNull();
  });

  it("rejects Windows UNC path (\\\\server\\share)", () => {
    expect(validateSupportingPath("\\\\server\\share")).toBeNull();
  });

  // 非字符串 → null
  it("returns null for non-string value", () => {
    expect(validateSupportingPath(42)).toBeNull();
    expect(validateSupportingPath(null)).toBeNull();
    expect(validateSupportingPath(undefined)).toBeNull();
  });

  // 空字符串 → null
  it("returns null for empty string", () => {
    expect(validateSupportingPath("")).toBeNull();
  });
});

describe("SPEC-DATA-001: validateFormaExtension productIcon", () => {
  const validProductIcon = {
    primary: "assets/icon.svg",
    monochrome: "assets/icon-mono.svg",
    shape: { shapeId: "s1", geometry: "<path d='M0 0h8v8H0z'/>", sourceVersion: "1" },
  };

  it("accepts a valid productIcon", () => {
    const r = validateFormaExtension({ productIcon: validProductIcon });
    expect(r.ok).toBe(true);
  });

  it("tolerates absence of productIcon (no throw, ok:true)", () => {
    expect(validateFormaExtension({}).ok).toBe(true);
    expect(validateFormaExtension({ brandStyle: "ant" }).ok).toBe(true);
  });

  it("rejects absolute path in productIcon.primary", () => {
    const r = validateFormaExtension({
      productIcon: { ...validProductIcon, primary: "/abs/icon.svg" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/productIcon\.primary/);
  });

  it("rejects path traversal in productIcon.monochrome", () => {
    const r = validateFormaExtension({
      productIcon: { ...validProductIcon, monochrome: "../escape.svg" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/productIcon\.monochrome/);
  });

  it("rejects empty shapeId", () => {
    const r = validateFormaExtension({
      productIcon: { ...validProductIcon, shape: { shapeId: "", geometry: "<path/>", sourceVersion: "1" } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/shapeId/);
  });

  it("rejects empty geometry", () => {
    const r = validateFormaExtension({
      productIcon: { ...validProductIcon, shape: { shapeId: "s1", geometry: "", sourceVersion: "1" } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/geometry/);
  });

  it("rejects empty sourceVersion", () => {
    const r = validateFormaExtension({
      productIcon: { ...validProductIcon, shape: { shapeId: "s1", geometry: "<path/>", sourceVersion: "" } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/sourceVersion/);
  });

  it("rejects missing shape object", () => {
    const { shape: _s, ...noShape } = validProductIcon;
    const r = validateFormaExtension({ productIcon: noShape });
    expect(r.ok).toBe(false);
  });

  it("accepts productIcon alongside other valid forma fields", () => {
    const r = validateFormaExtension({
      brandStyle: "ant",
      productIcon: validProductIcon,
      assets: [{ path: "assets/bg.png", density: [1], role: "image" }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("A1 manifest.forma extension + kind migration", () => {
  it("accepts new kinds design-page and component-library", () => {
    expect(ALLOWED_KINDS).toContain("design-page");
    expect(ALLOWED_KINDS).toContain("component-library");
    expect(ALLOWED_KINDS).toContain("html");
    expect(ALLOWED_KINDS).toContain("design-system");
  });

  it("normalizeKind maps legacy kinds to new", () => {
    expect(normalizeKind("html")).toBe("design-page");
    expect(normalizeKind("design-system")).toBe("component-library");
    expect(normalizeKind("design-page")).toBe("design-page");
    expect(normalizeKind("svg")).toBe("svg");
  });

  it("validateFormaExtension accepts a full valid extension", () => {
    const r = validateFormaExtension({
      requirementId: "R-1234abcd",
      pageId: "login",
      variant: "default",
      brandStyle: "ant",
      systemStyle: "shadcn-ui",
      platform: "web",
      language: "zh-CN",
      provenance: {
        model: "claude",
        sourceSkillId: "fm-design",
        generatedAt: "2026-05-30T00:00:00.000Z",
        promptDigest: "abc",
      },
      quality: { craftChecks: [{ id: "accent-budget", passed: true }] },
      preview: { status: "ready", generatedAt: "2026-05-30T00:00:00.000Z" },
      assets: [{ path: "assets/hero@1x.png", density: [1, 2], role: "image" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects invalid forma fields (bad preview status, empty variant, asset density not array)", () => {
    expect(validateFormaExtension({ preview: { status: "pending" } }).ok).toBe(false);
    expect(validateFormaExtension({ variant: "" }).ok).toBe(false);
    expect(validateFormaExtension({ assets: [{ path: "assets/a.png", density: 1, role: "image" }] }).ok).toBe(false);
    // 空 density 数组必须被拒（错误文案要求 non-empty）
    expect(validateFormaExtension({ assets: [{ path: "assets/a.png", density: [], role: "image" }] }).ok).toBe(false);
    expect(validateFormaExtension({ assets: [{ path: "../escape.png", density: [1], role: "image" }] }).ok).toBe(false);
  });

  it("design-page manifest requires forma and forma.variant; legacy missing variant normalizes to default", () => {
    const base = {
      version: 1,
      id: "AbCdEfGhIjKlMnOp",
      kind: "design-page",
      renderer: "html",
      title: "Login",
      entry: "index.html",
      status: "complete",
      exports: ["index.html"],
      createdAt: "2026-05-30T00:00:00.000Z",
      updatedAt: "2026-05-30T00:00:00.000Z",
    };
    expect(validateArtifactManifest(base).ok).toBe(false);
    expect(validateArtifactManifest({ ...base, forma: { requirementId: "R-1234abcd", pageId: "login" } }).ok).toBe(
      false,
    );
    const ok = validateArtifactManifest({
      ...base,
      forma: { requirementId: "R-1234abcd", pageId: "login", variant: "default" },
    });
    expect(ok.ok).toBe(true);
    expect(normalizeFormaExtension({ pageId: "login" }).variant).toBe("default");
  });

  it("non-forma legacy manifest still validates (additive)", () => {
    const legacy = {
      version: 1,
      id: "AbCdEfGhIjKlMnOp",
      kind: "html",
      renderer: "html",
      title: "Old",
      entry: "index.html",
      status: "complete",
      exports: ["index.html"],
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    };
    expect(validateArtifactManifest(legacy).ok).toBe(true);
  });
});

import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFormaStore,
  listV6NormalizationPreflightReports,
  normalizeFormaHomeForV6,
  recoverV6NormalizationJournal,
  readLatestV6NormalizationPreflightReport,
  readSchemaNormalizationRecoveryState,
  readV6NormalizationPreflightReport,
  readYamlUnknown,
  restoreV6NormalizationBackup,
  writeYamlAtomic
} from "../src/index.js";

const createdAt = "2026-05-21T00:00:00.000Z";

describe("schema normalization preflight", () => {
  it("writes only the explicit preflight report path and leaves runtime YAML unchanged", async () => {
    const home = await createLegacyHome();
    const runtimeFiles = await runtimeYamlFiles(home);
    const before = await readFiles(runtimeFiles);

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    expect(report.report_file).toBe(`normalization-preflight/v6-${createdAt}/report.yaml`);
    expect(report.report_dir).toBe(`normalization-preflight/v6-${createdAt}`);
    await expect(readFile(join(home, report.report_file), "utf8")).resolves.toContain(createdAt);
    expect(await readFiles(runtimeFiles)).toEqual(before);
    expect(await runtimeYamlFiles(home)).toEqual(runtimeFiles);
  });

  it("reports old components_initialized and pages design_id as planned field removals", async () => {
    const home = await createLegacyHome({
      productPatch: { components_initialized: true },
      pagePatch: { design_id: "D-11111111" }
    });

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    expect(report.status).toBe("passed");
    expect(report.strict_schema_status).toBe("passed");
    expect(report.field_removal_counts).toMatchObject({
      components_initialized: 1,
      design_id: 1
    });
    expect(report.schema_validation_diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PRODUCT_COMPONENTS_INITIALIZED_REMOVED" }),
        expect.objectContaining({ code: "REQUIREMENT_PAGE_DESIGN_ID_REMOVED" })
      ])
    );
  });

  it("reports product/baseline semantic aggregate conflicts", async () => {
    const home = await createLegacyHome();
    await writeYamlAtomic(join(home, "data", "P-123abc", "R-22222222", "requirement.yaml"), {
      ...requirementFixture("R-22222222"),
      pages: [
        {
          ...requirementPageFixture(),
          page_id: "login-alt",
          semantic_contract: {
            fields: [{ key: "email", label: "Email address" }],
            actions: [],
            navigation: [],
            component_keys: [],
            allowed_copy: []
          }
        }
      ]
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "R-11111111", "requirement.yaml"), {
      ...requirementFixture("R-11111111"),
      pages: [
        {
          ...requirementPageFixture(),
          semantic_contract: {
            fields: [{ key: "email", label: "Email" }],
            actions: [],
            navigation: [],
            component_keys: [],
            allowed_copy: []
          }
        }
      ]
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "baseline", "baseline.yaml"), {
      product_id: "P-123abc",
      pages: [
        {
          ...baselinePageFixture(),
          source_requirements: ["R-11111111", "R-22222222"]
        }
      ],
      navigation: []
    });

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    expect(report.status).toBe("failed");
    expect(report.schema_validation_diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BASELINE_SEMANTIC_CONTRACT_CONFLICT",
          path: "data/P-123abc/baseline/baseline.yaml"
        })
      ])
    );
  });

  it("records strict schema status separately from validator source", async () => {
    const home = await createLegacyHome();

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    expect(report.status).toBe("passed");
    expect(report.strict_schema_status).toBe("passed");
    expect(report.candidates.length).toBeGreaterThan(0);
    expect(report.candidates.every((candidate) => candidate.validator_source === "preflight_candidate_validator")).toBe(true);
    expect(report.candidates.every((candidate) => candidate.validation_status === "passed")).toBe(true);
    expect(report.candidates.every((candidate) => candidate.validator_source !== report.strict_schema_status)).toBe(true);
  });

  it("includes copy translation candidates without requiring complete non-default languages", async () => {
    const home = await createLegacyHome();
    await writeYamlAtomic(join(home, "data", "P-123abc", "R-11111111", "copy-translations.yaml"), {
      translations: [
        {
          page_id: "login",
          entries: [{ context: "cta", texts: { "zh-CN": "登录" } }]
        }
      ]
    });

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    expect(report.status).toBe("passed");
    expect(report.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "data/P-123abc/R-11111111/copy-translations.yaml",
          validator_source: "preflight_candidate_validator",
          validation_status: "passed"
        })
      ])
    );
  });

  it("rejects createdAt path traversal before writing a report", async () => {
    const home = await createLegacyHome();

    await expect(normalizeFormaHomeForV6(home, { mode: "preflight", createdAt: "2026/../../escaped" })).rejects.toThrow(
      "createdAt"
    );
    await expect(readFile(join(home, "escaped", "report.yaml"), "utf8")).rejects.toThrow();
  });

  it("rejects symlinked normalization-preflight root without writing outside home", async () => {
    const home = await createLegacyHome();
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-outside-preflight-"));
    await symlink(outside, join(home, "normalization-preflight"));

    await expect(normalizeFormaHomeForV6(home, { mode: "preflight", createdAt })).rejects.toThrow(
      "normalization-preflight"
    );
    await expect(readFile(join(outside, `v6-${createdAt}`, "report.yaml"), "utf8")).rejects.toThrow();
  });

  it("fails malformed product semantic, requirement declarations, and baseline semantic contracts", async () => {
    const home = await createLegacyHome({
      productPatch: {
        rules: [
          {
            id: "rule-1",
            page_id: "login",
            given: "free text should not matter",
            when: "free text should not matter",
            then: "free text should not matter",
            semantic: {
              fields: [{ key: "email" }],
              actions: "submit",
              component_keys: ["primary_button", 123],
              allowed_copy: ["Sign in", false]
            }
          }
        ]
      },
      pagePatch: {
        declared_fields: [{ key: "email" }],
        declared_actions: "submit",
        declared_component_keys: ["primary_button", 123]
      }
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "baseline", "baseline.yaml"), {
      product_id: "P-123abc",
      pages: [
        {
          ...baselinePageFixture(),
          semantic_contract: {
            fields: [{ key: "email" }],
            actions: "submit",
            navigation: [],
            component_keys: ["primary_button"],
            allowed_copy: []
          }
        }
      ],
      navigation: []
    });

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    expect(report.status).toBe("failed");
    expect(report.strict_schema_status).toBe("failed");
    expect(report.schema_validation_diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PRODUCT_SEMANTIC_INVALID", path: "data/P-123abc/product.yaml" }),
        expect.objectContaining({ code: "REQUIREMENT_DECLARED_FIELDS_INVALID", path: "data/P-123abc/R-11111111/requirement.yaml" }),
        expect.objectContaining({ code: "REQUIREMENT_DECLARED_ACTIONS_INVALID", path: "data/P-123abc/R-11111111/requirement.yaml" }),
        expect.objectContaining({ code: "REQUIREMENT_DECLARED_COMPONENT_KEYS_INVALID", path: "data/P-123abc/R-11111111/requirement.yaml" }),
        expect.objectContaining({ code: "BASELINE_SEMANTIC_CONTRACT_INVALID", path: "data/P-123abc/baseline/baseline.yaml" })
      ])
    );
  });

  it("fails invalid baseline semantic_contract_coverage", async () => {
    const home = await createLegacyHome();
    await writeYamlAtomic(join(home, "data", "P-123abc", "baseline", "baseline.yaml"), {
      product_id: "P-123abc",
      pages: [
        {
          ...baselinePageFixture(),
          semantic_contract_coverage: "guessed",
          semantic_contract: {
            fields: [],
            actions: [],
            navigation: [],
            component_keys: [],
            allowed_copy: []
          }
        }
      ],
      navigation: []
    });

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    expect(report.status).toBe("failed");
    expect(report.schema_validation_diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BASELINE_SEMANTIC_CONTRACT_COVERAGE_INVALID",
          path: "data/P-123abc/baseline/baseline.yaml"
        })
      ])
    );
  });

  it("raw-reads old page-level D-* design metadata YAML without deleting it", async () => {
    const home = await createLegacyHome();
    const designFile = join(home, "data", "P-123abc", "R-11111111", "D-11111111", "design.yaml");
    await writeYamlAtomic(designFile, {
      design_id: "D-11111111",
      page_id: "login",
      pen_file: "data/P-123abc/R-11111111/D-11111111/design.pen",
      preview_file: "data/P-123abc/R-11111111/D-11111111/preview@2x.png"
    });
    const before = await readFile(designFile, "utf8");

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    expect(await readFile(designFile, "utf8")).toBe(before);
    expect(report.status).toBe("passed");
    expect(report.candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "data/P-123abc/R-11111111/D-11111111/design.yaml"
        })
      ])
    );
  });

  it("uses product semantic rules and baseline label when generating minimal requirement contracts", async () => {
    const home = await createLegacyHome({
      productPatch: {
        rules: [
          {
            id: "rule-1",
            page_id: "login",
            given: "Must not become copy",
            when: "Must not become an action",
            then: "Must not become a field",
            semantic: {
              fields: [{ key: "password", label: "Password" }],
              actions: [{ key: "submit_login", label: "Submit login" }],
              component_keys: ["primary_button"],
              allowed_copy: ["Forgot password?"]
            }
          }
        ]
      }
    });

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    const requirementCandidate = report.candidates.find((candidate) => candidate.path === "data/P-123abc/R-11111111/requirement.yaml");
    expect(requirementCandidate?.validation_status).toBe("passed");
    expect(requirementCandidate?.candidate).toMatchObject({
      pages: [
        {
          semantic_contract: {
            fields: [{ key: "password", label: "Password" }],
            actions: [{ key: "submit_login", label: "Submit login" }],
            component_keys: ["primary_button"],
            allowed_copy: expect.arrayContaining(["Forgot password?", "Login"])
          }
        }
      ]
    });
    expect(requirementCandidate?.candidate).not.toEqual(
      expect.objectContaining({
        pages: [
          expect.objectContaining({
            semantic_contract: expect.objectContaining({
              allowed_copy: expect.arrayContaining(["Must not become copy"])
            })
          })
        ]
      })
    );
  });

  it("refuses cutover before a current passing preflight report exists", async () => {
    const home = await createLegacyHome();

    await expect(normalizeFormaHomeForV6(home, { mode: "cutover", createdAt })).resolves.toMatchObject({
      status: "failed",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
      preflight_status: "missing",
      preflight_reason: "report_missing"
    });
  });
});

describe("schema normalization cutover", () => {
  it("requires a current passing preflight report and rejects stale home hashes", async () => {
    const home = await createLegacyHome();
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await writeFile(join(home, "data", "P-123abc", "extra.yaml"), "changed: true\n", "utf8");

    await expect(normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" })).resolves.toMatchObject({
      status: "failed",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
      preflight_status: "stale",
      preflight_reason: "report_stale"
    });
    await expect(access(join(home, ".v6-schema-cutover-committed"))).rejects.toThrow();
  });

  it("accepts an explicit current preflight report path and rejects explicit reports outside home", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-report-outside-"));
    await writeYamlAtomic(join(outside, "report.yaml"), report);

    await expect(normalizeFormaHomeForV6(home, {
      mode: "cutover",
      createdAt: "2026-05-21T01:00:00.000Z",
      reportPath: join(outside, "report.yaml")
    })).resolves.toMatchObject({
      status: "failed",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
      preflight_reason: "report_path_outside_home"
    });

    await expect(normalizeFormaHomeForV6(home, {
      mode: "cutover",
      createdAt: "2026-05-21T01:00:00.000Z",
      reportPath: join(home, report.report_file)
    })).resolves.toMatchObject({
      status: "committed"
    });
  });

  it("creates backups, journal, markers, and rewrites only documented v6 runtime YAML fields", async () => {
    const home = await createLegacyHome({
      productPatch: { components_initialized: true },
      pagePatch: {
        design_id: "D-11111111",
        design_metadata: { legacy: true },
        pen_path: "data/P-123abc/R-11111111/D-11111111/design.pen",
        preview_path: "data/P-123abc/R-11111111/D-11111111/preview@2x.png"
      }
    });
    const oldDesignDirFile = join(home, "data", "P-123abc", "R-11111111", "D-11111111", "design.yaml");
    await writeYamlAtomic(oldDesignDirFile, { design_id: "D-11111111", page_id: "login" });
    const oldDesignDirBefore = await readFile(oldDesignDirFile, "utf8");
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    const result = await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });

    expect(result).toMatchObject({ status: "committed", strict_schema_status: "passed" });
    await expect(access(join(home, ".v6-schema-cutover-active"))).rejects.toThrow();
    await expect(access(join(home, ".v6-schema-cutover-committed"))).resolves.toBeUndefined();
    const product = await readYamlUnknown(join(home, "data", "P-123abc", "product.yaml")) as Record<string, unknown>;
    expect(product).not.toHaveProperty("components_initialized");
    const requirement = await readYamlUnknown(join(home, "data", "P-123abc", "R-11111111", "requirement.yaml")) as Record<string, unknown>;
    expect(requirement.pages).toEqual([
      expect.objectContaining({
        page_id: "login",
        semantic_contract_coverage: "minimal",
        semantic_contract: expect.objectContaining({ fields: [], actions: [], navigation: [], component_keys: [] })
      })
    ]);
    expect(requirement.pages).not.toEqual([
      expect.objectContaining({ design_id: expect.anything() })
    ]);
    const baseline = await readYamlUnknown(join(home, "data", "P-123abc", "baseline", "baseline.yaml")) as Record<string, unknown>;
    expect(baseline.pages).toEqual([
      expect.objectContaining({
        id: "login",
        semantic_contract_coverage: "minimal",
        semantic_contract: expect.any(Object)
      })
    ]);
    expect(await readFile(oldDesignDirFile, "utf8")).toBe(oldDesignDirBefore);

    const backupRoot = join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z");
    await expect(access(join(backupRoot, "manifest.yaml"))).resolves.toBeUndefined();
    const journal = await readYamlUnknown(join(backupRoot, "normalization-journal.yaml")) as Record<string, unknown>;
    expect(journal).toMatchObject({ status: "committed" });
    const productEntry = (journal.rewritten_files as Record<string, unknown>[]).find((file) => file.runtime_path === "data/P-123abc/product.yaml");
    expect(productEntry).toMatchObject({
      candidate_hash: sha256Text(await readFile(join(home, "data", "P-123abc", "product.yaml"), "utf8"))
    });
    expect(journal.rewritten_files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtime_path: "data/P-123abc/product.yaml",
          old_hash: expect.stringMatching(/^sha256:/),
          candidate_hash: expect.stringMatching(/^sha256:/),
          write_status: "written",
          validation_status: "passed",
          restore_status: "none"
        })
      ])
    );
    const normalizationReport = await readYamlUnknown(join(home, "normalization_report.yaml")) as Record<string, unknown>;
    expect(normalizationReport).toMatchObject({ status: "committed", strict_schema_status: "passed" });
  });

  it("keeps current requirement and baseline runtime services readable after cutover", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });

    const store = await createFormaStore({ home, bundledStylesDir: join(process.cwd(), "styles") });
    const requirement = await store.requirements.getRequirement({ requirement_id: "R-11111111" });
    const baseline = await store.baseline.getProductBaseline("P-123abc");

    expect(requirement.pages[0]).toMatchObject({
      page_id: "login",
      semantic_contract_coverage: "minimal",
      semantic_contract: expect.objectContaining({ fields: [], actions: [], navigation: [], component_keys: [] })
    });
    expect(baseline.pages[0]).toMatchObject({
      id: "login",
      semantic_contract_coverage: "minimal",
      semantic_contract: expect.objectContaining({ fields: [], actions: [], navigation: [], component_keys: [] })
    });
  });

  it("rejects symlinked runtime files during preflight before following them", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-runtime-file-symlink-"));
    const outsideProduct = join(outside, "product.yaml");
    await writeFile(outsideProduct, "id: P-123abc\nname: Outside\ncomponents_initialized: true\n", "utf8");
    await rm(join(home, "data", "P-123abc", "product.yaml"));
    await symlink(outsideProduct, join(home, "data", "P-123abc", "product.yaml"));

    await expect(normalizeFormaHomeForV6(home, { mode: "preflight", createdAt })).rejects.toThrow("symlink");
    expect(await readFile(outsideProduct, "utf8")).toContain("components_initialized: true");
    await expect(access(join(home, ".v6-schema-cutover-committed"))).rejects.toThrow();
  });

  it("rejects symlinked runtime parent directories before cutover writes outside home", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    const originalRequirement = await readFile(join(home, "data", "P-123abc", "R-11111111", "requirement.yaml"), "utf8");
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-runtime-dir-symlink-"));
    const outsideRequirementDir = join(outside, "R-11111111");
    await mkdir(outsideRequirementDir, { recursive: true });
    await writeFile(join(outsideRequirementDir, "requirement.yaml"), originalRequirement, "utf8");
    await rm(join(home, "data", "P-123abc", "R-11111111"), { recursive: true, force: true });
    await symlink(outsideRequirementDir, join(home, "data", "P-123abc", "R-11111111"));

    await expect(normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" })).rejects.toThrow("symlink");

    const outsideRequirement = await readYamlUnknown(join(outsideRequirementDir, "requirement.yaml")) as Record<string, unknown>;
    expect(outsideRequirement.pages).not.toEqual([
      expect.objectContaining({ semantic_contract: expect.anything() })
    ]);
    await expect(access(join(home, ".v6-schema-cutover-committed"))).rejects.toThrow();
  });

  it("rejects preexisting symlinked backup timestamp directories before writing backups outside home", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-backup-timestamp-symlink-"));
    await mkdir(join(home, "normalization-backups"), { recursive: true });
    await symlink(outside, join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z"));

    await expect(normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" })).rejects.toThrow("symlink");

    await expect(access(join(outside, "manifest.yaml"))).rejects.toThrow();
    await expect(access(join(outside, "data", "P-123abc", "product.yaml"))).rejects.toThrow();
    await expect(access(join(home, ".v6-schema-cutover-committed"))).rejects.toThrow();
  });

  it("rejects non-candidate symlinked runtime YAML while computing the home hash", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-hash-symlink-"));
    const outsideYaml = join(outside, "outside.yaml");
    await writeFile(outsideYaml, "secret: outside\n", "utf8");
    await symlink(outsideYaml, join(home, "data", "non-candidate.yaml"));

    await expect(normalizeFormaHomeForV6(home, { mode: "preflight", createdAt })).rejects.toThrow("symlink");

    expect(await readFile(outsideYaml, "utf8")).toBe("secret: outside\n");
    await expect(access(join(home, "normalization-preflight", `v6-${createdAt}`, "report.yaml"))).rejects.toThrow();
  });

  it("persists created journal before backup verification reaches backed_up", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    await expect(normalizeFormaHomeForV6(home, {
      mode: "cutover",
      createdAt: "2026-05-21T01:00:00.000Z",
      hooks: {
        afterJournalCreated: async () => {
          throw new Error("stop after created");
        }
      }
    })).rejects.toThrow("stop after created");

    const journal = await readYamlUnknown(join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z", "normalization-journal.yaml")) as Record<string, unknown>;
    expect(journal).toMatchObject({
      status: "recovery_required",
      previous_status: "created",
      rewritten_files: expect.arrayContaining([
        expect.objectContaining({
          runtime_path: "data/P-123abc/product.yaml",
          candidate_hash: null,
          write_status: "not_started"
        })
      ])
    });
  });

  it("records the actual written file hash before candidate hash mismatch recovery", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    await expect(normalizeFormaHomeForV6(home, {
      mode: "cutover",
      createdAt: "2026-05-21T01:00:00.000Z",
      hooks: {
        mutateCandidateBeforeWrite: (candidate) => {
          if (candidate.path === "data/P-123abc/product.yaml") {
            return { ...candidate.candidate, name: "Mutated after preflight" };
          }
          return candidate.candidate;
        }
      }
    })).rejects.toThrow("candidate hash mismatch");

    const runtimeProduct = await readFile(join(home, "data", "P-123abc", "product.yaml"), "utf8");
    const journal = await readYamlUnknown(join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z", "normalization-journal.yaml")) as Record<string, unknown>;
    expect(journal).toMatchObject({ status: "recovery_required" });
    expect(journal.rewritten_files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtime_path: "data/P-123abc/product.yaml",
          candidate_hash: sha256Text(runtimeProduct),
          write_status: "failed"
        })
      ])
    );
  });

  it("aborts before runtime writes when the backup root is unsafe", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    const before = await readFile(join(home, "data", "P-123abc", "product.yaml"), "utf8");
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-outside-backups-"));
    await symlink(outside, join(home, "normalization-backups"));

    await expect(normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" })).rejects.toThrow(
      "normalization-backups"
    );
    expect(await readFile(join(home, "data", "P-123abc", "product.yaml"), "utf8")).toBe(before);
    await expect(access(join(home, ".v6-schema-cutover-committed"))).rejects.toThrow();
  });

  it("enters recovery-only mode when post-write strict validation fails", async () => {
    const home = await createLegacyHome({
      pagePatch: {
        semantic_contract: {
          fields: [{ key: "email" }],
          actions: [],
          navigation: [],
          component_keys: [],
          allowed_copy: []
        }
      }
    });
    const failedReport = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    expect(failedReport.strict_schema_status).toBe("failed");
    await writeYamlAtomic(join(home, failedReport.report_file), {
      ...failedReport,
      status: "passed",
      strict_schema_status: "passed",
      candidates: failedReport.candidates.map((candidate) => ({
        ...candidate,
        validation_status: "passed"
      }))
    });

    await expect(normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" })).rejects.toThrow(
      "strict candidate validation"
    );
    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "recovery_only",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      restore_status: "restore_failed"
    });
  });

  it("fails strict candidate validation for undocumented unknown runtime fields", async () => {
    const home = await createLegacyHome({
      productPatch: { legacy_blob: true },
      pagePatch: { legacy_page_field: "old" }
    });

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });

    expect(report.status).toBe("failed");
    expect(report.strict_schema_status).toBe("failed");
    expect(report.schema_validation_diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PRODUCT_UNKNOWN_FIELD", path: "data/P-123abc/product.yaml" }),
        expect.objectContaining({ code: "REQUIREMENT_PAGE_UNKNOWN_FIELD", path: "data/P-123abc/R-11111111/requirement.yaml" })
      ])
    );
  });

  it("fails preflight for candidate fields unsupported by current runtime schemas", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await writeYamlAtomic(join(home, "data", "P-123abc", "R-11111111", "requirement.yaml"), {
      ...requirementFixture("R-11111111"),
      document_md: "# Inline document is not runtime YAML",
      rules: [{ id: "rule-1", given: "x", when: "y", then: "z" }],
      translations: [{ page_id: "login", entries: [] }]
    });
    await writeYamlAtomic(join(home, "data", "P-123abc", "baseline", "baseline.yaml"), {
      product_id: "P-123abc",
      pages: [
        {
          ...baselinePageFixture(),
          source_semantic_contracts: [
            {
              source_requirement: "R-11111111",
              page_id: "login",
              semantic_contract: { fields: [], actions: [], navigation: [], component_keys: [], allowed_copy: [] }
            }
          ]
        }
      ],
      navigation: []
    });

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    const cutover = await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });

    expect(report).toMatchObject({ status: "failed", strict_schema_status: "failed" });
    expect(report.schema_validation_diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "REQUIREMENT_UNKNOWN_FIELD", message: expect.stringContaining("document_md") }),
        expect.objectContaining({ code: "REQUIREMENT_UNKNOWN_FIELD", message: expect.stringContaining("rules") }),
        expect.objectContaining({ code: "REQUIREMENT_UNKNOWN_FIELD", message: expect.stringContaining("translations") }),
        expect.objectContaining({ code: "BASELINE_PAGE_UNKNOWN_FIELD", message: expect.stringContaining("source_semantic_contracts") })
      ])
    );
    expect(cutover).toMatchObject({
      status: "failed",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
      preflight_status: "failed"
    });
    await expect(access(join(home, ".v6-schema-cutover-committed"))).rejects.toThrow();
  });

  it("fails preflight for product root fields unsupported by the current runtime schema", async () => {
    const home = await createLegacyHome({
      productPatch: {
        components_initialized: true,
        rules: [
          {
            id: "rule-1",
            page_id: "login",
            given: "x",
            when: "y",
            then: "z",
            semantic: { fields: [], actions: [], component_keys: [], allowed_copy: [] }
          }
        ],
        created_at: createdAt,
        updated_at: createdAt
      }
    });

    const report = await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    const cutover = await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });

    expect(report).toMatchObject({ status: "failed", strict_schema_status: "failed" });
    expect(report.schema_validation_diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PRODUCT_UNKNOWN_FIELD", message: expect.stringContaining("rules") }),
        expect.objectContaining({ code: "PRODUCT_UNKNOWN_FIELD", message: expect.stringContaining("created_at") }),
        expect.objectContaining({ code: "PRODUCT_UNKNOWN_FIELD", message: expect.stringContaining("updated_at") })
      ])
    );
    expect(cutover).toMatchObject({
      status: "failed",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
      preflight_status: "failed"
    });
    await expect(access(join(home, ".v6-schema-cutover-committed"))).rejects.toThrow();
  });
});

describe("schema normalization recovery and rollback", () => {
  it("recovers a no-runtime-writes journal by marking it restored", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-recover-created-"));
    await writeJournal(home, createdAt, {
      status: "created",
      rewritten_files: []
    });

    await expect(recoverV6NormalizationJournal(home, join(home, `normalization-backups/v6-${createdAt}`))).resolves.toMatchObject({
      status: "restored",
      restore_status: "no_runtime_writes"
    });
    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "preflight_only",
      status: "preflight_required",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED"
    });
  });

  it("restores modified YAML from a recovery journal and blocks backup paths outside home", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    const backupDir = join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z");
    await writeFile(join(home, ".v6-schema-cutover-active"), "active\n", "utf8");
    await writeFile(join(home, "data", "P-123abc", "product.yaml"), "id: P-123abc\nname: broken\n", "utf8");

    await expect(recoverV6NormalizationJournal(home, join(home, "normalization-backups", ".."))).rejects.toThrow("backup-dir");
    const recovered = await recoverV6NormalizationJournal(home, backupDir);

    expect(recovered).toMatchObject({ status: "restored" });
    const product = await readYamlUnknown(join(home, "data", "P-123abc", "product.yaml")) as Record<string, unknown>;
    expect(product).toHaveProperty("components_initialized", true);
  });

  it("resolves relative backup directories from the Forma home for recovery commands", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    await writeFile(join(home, ".v6-schema-cutover-active"), "active\n", "utf8");
    await writeFile(join(home, "data", "P-123abc", "product.yaml"), "id: P-123abc\nname: broken\n", "utf8");

    const recovered = await recoverV6NormalizationJournal(home, "normalization-backups/v6-2026-05-21T01:00:00.000Z");

    expect(recovered).toMatchObject({
      status: "restored",
      backup_dir: "normalization-backups/v6-2026-05-21T01:00:00.000Z"
    });
    await expect(recoverV6NormalizationJournal(home, "../normalization-backups/v6-2026-05-21T01:00:00.000Z")).rejects.toThrow();
  });

  it("requires confirmation for rollback and captures current runtime YAML before restore", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    const backupDir = join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z");

    await expect(restoreV6NormalizationBackup(home, backupDir, { confirm: "wrong" })).rejects.toThrow("restore_v6_backup");
    const restored = await restoreV6NormalizationBackup(home, backupDir, { confirm: "restore_v6_backup" });

    expect(restored).toMatchObject({ status: "restored" });
    await expect(access(join(home, ".v6-schema-cutover-committed"))).rejects.toThrow();
    await expect(access(join(backupDir, "rollback-capture", "data", "P-123abc", "product.yaml"))).resolves.toBeUndefined();
    const report = await readYamlUnknown(join(home, "normalization_report.yaml")) as Record<string, unknown>;
    expect(report).toMatchObject({ status: "restored" });
  });

  it("keeps committed marker when restore cannot write restored report", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    const backupDir = join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z");
    await rm(join(home, "normalization_report.yaml"));
    await mkdir(join(home, "normalization_report.yaml"));

    await expect(restoreV6NormalizationBackup(home, backupDir, { confirm: "restore_v6_backup" })).rejects.toThrow();

    await expect(access(join(home, ".v6-schema-cutover-committed"))).resolves.toBeUndefined();
  });

  it("fails restore when restored old runtime YAML does not pass the old schema smoke check", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    const backupDir = join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z");
    const backupProduct = join(backupDir, "data", "P-123abc", "product.yaml");
    await writeFile(backupProduct, "id: 123\nname: false\n", "utf8");
    await rewriteManifestEntryHash(home, "2026-05-21T01:00:00.000Z", "data/P-123abc/product.yaml", sha256Text("id: 123\nname: false\n"));

    await expect(restoreV6NormalizationBackup(home, backupDir, { confirm: "restore_v6_backup" })).rejects.toThrow("old schema smoke");
    await expect(access(join(home, ".v6-schema-cutover-active"))).resolves.toBeUndefined();
    await expect(access(join(home, ".v6-schema-cutover-committed"))).resolves.toBeUndefined();
  });

  it("wraps old-schema smoke restore failures as structured recovery errors", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    const backupDir = join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z");
    const backupProduct = join(backupDir, "data", "P-123abc", "product.yaml");
    await writeFile(backupProduct, "id: 123\nname: false\n", "utf8");
    await rewriteManifestEntryHash(home, "2026-05-21T01:00:00.000Z", "data/P-123abc/product.yaml", sha256Text("id: 123\nname: false\n"));

    await expect(restoreV6NormalizationBackup(home, backupDir, { confirm: "restore_v6_backup" })).rejects.toMatchObject({
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      result: {
        restore_status: "restore_failed",
        failed_files: [
          expect.objectContaining({
            runtime_path: "data/P-123abc/product.yaml",
            reason: expect.stringContaining("old schema smoke")
          })
        ]
      }
    });
  });

  it("leaves recovery active when rollback restore fails before completion", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    const backupDir = join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z");
    await writeFile(join(backupDir, "data", "P-123abc", "product.yaml"), "corrupt backup\n", "utf8");

    await expect(restoreV6NormalizationBackup(home, backupDir, { confirm: "restore_v6_backup" })).rejects.toThrow("backup hash mismatch");
    await expect(access(join(home, ".v6-schema-cutover-active"))).resolves.toBeUndefined();
    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "recovery_only",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED"
    });
  });

  it("blocks recovery when runtime target is a symlink escape", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    const backupDir = join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z");
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-runtime-escape-"));
    await rm(join(home, "data", "P-123abc", "product.yaml"));
    await symlink(join(outside, "product.yaml"), join(home, "data", "P-123abc", "product.yaml"));

    await expect(recoverV6NormalizationJournal(home, backupDir)).rejects.toMatchObject({
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED"
    });
    await expect(readFile(join(outside, "product.yaml"), "utf8")).rejects.toThrow();
  });

  it("blocks recovery when backup file is a symlink escape", async () => {
    const home = await createLegacyHome({ productPatch: { components_initialized: true } });
    await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
    await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
    const backupDir = join(home, "normalization-backups", "v6-2026-05-21T01:00:00.000Z");
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-backup-escape-"));
    await rm(join(backupDir, "data", "P-123abc", "product.yaml"));
    await symlink(join(outside, "product.yaml"), join(backupDir, "data", "P-123abc", "product.yaml"));

    await expect(recoverV6NormalizationJournal(home, backupDir)).rejects.toMatchObject({
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED"
    });
  });
});

describe("schema normalization report selection", () => {
  it("selects the latest preflight report from YAML content fields, never mtime", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-reports-"));
    const older = "2026-05-20T00:00:00.000Z";
    const newer = "2026-05-21T00:00:00.000Z";
    await writeReport(home, newer, { status: "passed", home_hash: "sha256:newer" });
    await writeReport(home, older, { status: "passed", home_hash: "sha256:older" });
    await utimes(join(home, `normalization-preflight/v6-${older}/report.yaml`), new Date(), new Date());

    const reports = await listV6NormalizationPreflightReports(home);
    const latest = await readLatestV6NormalizationPreflightReport(home);

    expect(reports.map((report) => report.report.created_at)).toEqual([newer, older]);
    expect(latest).toMatchObject({ ok: true, report: { created_at: newer, home_hash: "sha256:newer" } });
  });

  it("rejects ambiguous or self-inconsistent preflight reports as stale", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-ambiguous-report-"));
    await writeReport(home, createdAt, {
      created_at: "2026-05-20T00:00:00.000Z",
      status: "passed"
    });

    await expect(readV6NormalizationPreflightReport(home, join(home, `normalization-preflight/v6-${createdAt}/report.yaml`))).resolves.toMatchObject({
      ok: false,
      state: {
        code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
        preflight_status: "stale",
        preflight_reason: "report_selection_ambiguous"
      }
    });
    await expect(readLatestV6NormalizationPreflightReport(home)).resolves.toMatchObject({
      ok: false,
      state: {
        code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
        preflight_status: "stale",
        preflight_reason: "report_selection_ambiguous"
      }
    });
  });
});

describe("schema normalization recovery state", () => {
  it("treats an empty new home without committed marker as preflight-only without writing normalization artifacts", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-empty-home-"));
    const before = await treeSnapshot(home);

    const state = await readSchemaNormalizationRecoveryState(home);

    expect(state).toMatchObject({
      mode: "preflight_only",
      status: "preflight_required",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
      restore_status: "none",
      failed_files: [],
      recovery_actions: ["run_schema_normalization_dry_run", "run_v6_schema_cutover"]
    });
    await expect(createFormaStore({ home })).rejects.toMatchObject({ state });
    expect(await treeSnapshot(home)).toEqual(before);
    await expect(readFile(join(home, "normalization-preflight", `v6-${createdAt}`, "report.yaml"), "utf8")).rejects.toThrow();
    await expect(readFile(join(home, "normalization-backups", `v6-${createdAt}`, "normalization-journal.yaml"), "utf8")).rejects.toThrow();
  });

  it("keeps legacy runtime YAML without committed marker in preflight-only mode", async () => {
    const home = await createLegacyHome();

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "preflight_only",
      status: "preflight_required",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
      preflight_status: "missing",
      preflight_reason: "report_missing"
    });
    await expect(createFormaStore({ home })).rejects.toMatchObject({
      state: {
        mode: "preflight_only",
        code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED"
      }
    });
  });

  it("does not treat a restored normalization report as normal without committed marker", async () => {
    const home = await createLegacyHome();
    await writeYamlAtomic(join(home, "normalization_report.yaml"), {
      status: "restored",
      created_at: createdAt,
      normalizer_version: "v6-stage-01"
    });

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "preflight_only",
      status: "preflight_required",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED"
    });
    await expect(createFormaStore({ home })).rejects.toMatchObject({
      state: { mode: "preflight_only", code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED" }
    });
  });

  it("createFormaStore awaits normal recovery state before products are accessed", async () => {
    const home = await createStrictCommittedHome();

    const store = await createFormaStore({ home });

    await expect(store.products.listProducts()).resolves.toEqual([
      { id: "P-123abc", name: "Shop", description: "Shop app" }
    ]);
  });

  it("normal createFormaStore startup does not run preflight or cutover writes", async () => {
    const home = await createStrictCommittedHome();
    const before = await treeSnapshot(home);

    await createFormaStore({ home });

    expect(await treeSnapshot(home)).toEqual(before);
    await expect(readFile(join(home, "normalization-preflight", "v6-2026-05-21T02:00:00.000Z", "report.yaml"), "utf8")).rejects.toThrow();
    await expect(readFile(join(home, "normalization-backups", "v6-2026-05-21T02:00:00.000Z", "normalization-journal.yaml"), "utf8")).rejects.toThrow();
  });

  it("createFormaStore rejects with the full raw recovery state before strict services start", async () => {
    const home = await createLegacyHome();
    const state = await readSchemaNormalizationRecoveryState(home);
    const before = await treeSnapshot(home);

    await expect(createFormaStore({ home })).rejects.toMatchObject({ state });

    expect(await treeSnapshot(home)).toEqual(before);
  });

  it("does not create, modify, repair, or delete files while reading recovery state", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-readonly-"));
    await mkdir(join(home, "data"), { recursive: true });
    await writeFile(join(home, "data", "note.txt"), "unchanged", "utf8");
    const before = await treeSnapshot(home);

    const state = await readSchemaNormalizationRecoveryState(home);

    expect(state).toMatchObject({
      mode: "preflight_only",
      status: "preflight_required",
      message: "v6 schema normalization preflight is required",
      restore_status: "none"
    });
    expect(await treeSnapshot(home)).toEqual(before);
  });

  it("detects journal selection ambiguity from YAML content fields", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-ambiguous-journal-"));
    await writeJournal(home, "2026-05-20T00:00:00.000Z", { status: "writing" });
    await writeJournal(home, "2026-05-21T00:00:00.000Z", { status: "recovery_required" });

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "recovery_only",
      status: "recovery_required",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      restore_status: "journal_selection_ambiguous"
    });
  });

  it("reports no_runtime_writes for created or backed_up journals with untouched runtime files", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-no-runtime-writes-"));
    await writeJournal(home, createdAt, {
      status: "created",
      rewritten_files: [{ runtime_path: "data/P-123abc/product.yaml", backup_path: "normalization-backups/v6-x/product.yaml", old_hash: "sha256:old", candidate_hash: null, write_status: "not_started" }]
    });

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "recovery_only",
      status: "recovery_required",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      restore_status: "no_runtime_writes",
      failed_files: []
    });
  });

  it("reports manifest_unavailable when journal manifest is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-missing-manifest-"));
    await writeJournal(home, createdAt, {
      status: "writing",
      rewritten_files: [{ runtime_path: "data/P-123abc/product.yaml", backup_path: `normalization-backups/v6-${createdAt}/data/P-123abc/product.yaml`, old_hash: "sha256:old", candidate_hash: "sha256:new", write_status: "written" }]
    });
    await rm(join(home, `normalization-backups/v6-${createdAt}/manifest.yaml`));

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "recovery_only",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      restore_status: "manifest_unavailable"
    });
  });

  it("reports manifest_unavailable when journal and manifest hashes differ", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-manifest-mismatch-"));
    await writeJournal(home, createdAt, {
      status: "writing",
      manifest_hash: "sha256:journal",
      rewritten_files: [{ runtime_path: "data/P-123abc/product.yaml", backup_path: `normalization-backups/v6-${createdAt}/data/P-123abc/product.yaml`, old_hash: "sha256:old", candidate_hash: "sha256:new", write_status: "written" }]
    });
    await writeYamlAtomic(join(home, `normalization-backups/v6-${createdAt}/manifest.yaml`), {
      manifest_hash: "sha256:manifest",
      files: []
    });

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "recovery_only",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      restore_status: "manifest_unavailable"
    });
  });

  it("rejects traversing journal manifest_path before trusting readable YAML", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-manifest-traversal-"));
    await writeJournal(home, createdAt, {
      status: "writing",
      manifest_path: `normalization-backups/v6-${createdAt}/../outside-manifest.yaml`,
      rewritten_files: []
    });
    await writeYamlAtomic(join(home, "normalization-backups", "outside-manifest.yaml"), {
      manifest_hash: "sha256:manifest",
      files: []
    });

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "recovery_only",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      restore_status: "manifest_unavailable"
    });
  });

  it("rejects symlinked backup dirs without reading outside-home journals", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-backup-symlink-home-"));
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-outside-backup-"));
    await mkdir(join(home, "normalization-backups"), { recursive: true });
    await symlink(outside, join(home, "normalization-backups", `v6-${createdAt}`));
    await writeYamlAtomic(join(outside, "manifest.yaml"), {
      manifest_hash: "sha256:manifest",
      files: []
    });
    await writeYamlAtomic(join(outside, "normalization-journal.yaml"), {
      created_at: createdAt,
      backup_dir: `normalization-backups/v6-${createdAt}`,
      manifest_path: `normalization-backups/v6-${createdAt}/manifest.yaml`,
      manifest_hash: "sha256:manifest",
      normalizer_version: "v6-stage-01",
      status: "writing",
      rewritten_files: []
    });

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "recovery_only",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      restore_status: "journal_selection_ambiguous"
    });
  });

  it("rejects symlinked journal files without reading outside backup dirs", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-journal-symlink-home-"));
    const outside = await mkdtemp(join(tmpdir(), "forma-normalization-outside-journal-"));
    const backupDir = join(home, "normalization-backups", `v6-${createdAt}`);
    await mkdir(backupDir, { recursive: true });
    await writeYamlAtomic(join(backupDir, "manifest.yaml"), {
      manifest_hash: "sha256:manifest",
      files: []
    });
    await writeYamlAtomic(join(outside, "normalization-journal.yaml"), {
      created_at: createdAt,
      backup_dir: `normalization-backups/v6-${createdAt}`,
      manifest_path: `normalization-backups/v6-${createdAt}/manifest.yaml`,
      manifest_hash: "sha256:manifest",
      normalizer_version: "v6-stage-01",
      status: "writing",
      rewritten_files: []
    });
    await symlink(join(outside, "normalization-journal.yaml"), join(backupDir, "normalization-journal.yaml"));

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "recovery_only",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      restore_status: "journal_selection_ambiguous"
    });
  });

  it("reports backup_hash_mismatch when backup file hashes do not match the journal", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-normalization-backup-mismatch-"));
    const backupFile = join(home, `normalization-backups/v6-${createdAt}/data/P-123abc/product.yaml`);
    await mkdir(join(home, `normalization-backups/v6-${createdAt}/data/P-123abc`), { recursive: true });
    await writeFile(backupFile, "changed backup", "utf8");
    await writeJournal(home, createdAt, {
      status: "writing",
      rewritten_files: [
        {
          runtime_path: "data/P-123abc/product.yaml",
          backup_path: `normalization-backups/v6-${createdAt}/data/P-123abc/product.yaml`,
          old_hash: sha256Text("original backup"),
          candidate_hash: "sha256:new",
          write_status: "written"
        }
      ]
    });

    await expect(readSchemaNormalizationRecoveryState(home)).resolves.toMatchObject({
      mode: "recovery_only",
      code: "SCHEMA_NORMALIZATION_RECOVERY_REQUIRED",
      restore_status: "backup_hash_mismatch"
    });
  });
});

async function createLegacyHome(options: {
  productPatch?: Record<string, unknown>;
  pagePatch?: Record<string, unknown>;
} = {}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "forma-normalization-"));
  await writeYamlAtomic(join(home, "data", "products.yaml"), {
    products: [{ id: "P-123abc", name: "Shop", description: "Shop app" }]
  });
  await writeYamlAtomic(join(home, "data", "P-123abc", "product.yaml"), {
    id: "P-123abc",
    name: "Shop",
    description: "Shop app",
    ...options.productPatch
  });
  await writeYamlAtomic(join(home, "data", "P-123abc", "R-11111111", "requirement.yaml"), {
    ...requirementFixture("R-11111111"),
    pages: [{ ...requirementPageFixture(), ...options.pagePatch }]
  });
  await writeYamlAtomic(join(home, "data", "P-123abc", "baseline", "baseline.yaml"), {
    product_id: "P-123abc",
    pages: [baselinePageFixture()],
    navigation: []
  });
  return home;
}

async function createStrictCommittedHome(): Promise<string> {
  const home = await createLegacyHome();
  await normalizeFormaHomeForV6(home, { mode: "preflight", createdAt });
  await normalizeFormaHomeForV6(home, { mode: "cutover", createdAt: "2026-05-21T01:00:00.000Z" });
  await markNormalizationCommitted(home);
  return home;
}

async function markNormalizationCommitted(home: string): Promise<void> {
  await writeFile(join(home, ".v6-schema-cutover-committed"), "committed\n", "utf8");
}

function requirementFixture(requirementId: string) {
  return {
    id: requirementId,
    product_id: "P-123abc",
    title: "Login",
    status: "submitted",
    ui_affected: true,
    created_at: createdAt,
    updated_at: createdAt,
    pages: [requirementPageFixture()],
    navigation: []
  };
}

function requirementPageFixture() {
  return {
    page_id: "login",
    name: "Login",
    baseline_page: "login",
    design_status: "pending",
    copy: [{ context: "cta", text: "Sign in" }]
  };
}

function baselinePageFixture() {
  return {
    id: "login",
    name: "Login",
    features: "",
    copy: [{ context: "cta", text: "Sign in" }],
    fields: "free-text field notes",
    interactions: "free-text interaction notes",
    source_requirements: ["R-11111111"]
  };
}

async function runtimeYamlFiles(home: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (file.endsWith(".yaml")) {
        files.push(file);
      }
    }
  }
  await visit(join(home, "data"));
  return files.sort();
}

async function readFiles(files: string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")] as const));
  return Object.fromEntries(entries);
}

async function writeReport(home: string, timestamp: string, patch: Record<string, unknown> = {}): Promise<void> {
  const reportDir = `normalization-preflight/v6-${timestamp}`;
  const reportFile = `${reportDir}/report.yaml`;
  await writeYamlAtomic(join(home, reportFile), {
    created_at: timestamp,
    report_dir: reportDir,
    report_file: reportFile,
    normalizer_version: "v6-stage-01",
    home_hash: "sha256:home",
    status: "passed",
    strict_schema_status: "passed",
    candidate_manifest_hash: "sha256:manifest",
    candidates: [],
    ...patch
  });
}

async function writeJournal(home: string, timestamp: string, patch: Record<string, unknown> = {}): Promise<void> {
  const backupDir = `normalization-backups/v6-${timestamp}`;
  await writeYamlAtomic(join(home, backupDir, "manifest.yaml"), {
    manifest_hash: "sha256:manifest",
    files: []
  });
  await writeYamlAtomic(join(home, backupDir, "normalization-journal.yaml"), {
    created_at: timestamp,
    backup_dir: backupDir,
    manifest_path: `${backupDir}/manifest.yaml`,
    manifest_hash: "sha256:manifest",
    normalizer_version: "v6-stage-01",
    status: "created",
    rewritten_files: [],
    ...patch
  });
}

async function treeSnapshot(root: string): Promise<Record<string, { size: number; mtimeMs: number }>> {
  const snapshot: Record<string, { size: number; mtimeMs: number }> = {};
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else {
        const info = await stat(file);
        snapshot[file.slice(root.length + 1)] = { size: info.size, mtimeMs: info.mtimeMs };
      }
    }
  }
  await visit(root);
  return snapshot;
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function rewriteManifestEntryHash(home: string, timestamp: string, runtimePath: string, hash: string): Promise<void> {
  const manifestFile = join(home, "normalization-backups", `v6-${timestamp}`, "manifest.yaml");
  const manifest = await readYamlUnknown(manifestFile) as Record<string, unknown>;
  const files = manifest.files as Array<Record<string, unknown>>;
  for (const file of files) {
    if (file.runtime_path === runtimePath) {
      file.sha256 = hash;
      file.file_size = Buffer.byteLength(await readFile(join(home, String(file.backup_path)), "utf8"));
    }
  }
  manifest.manifest_hash = hashUnknownForTest({ files, normalizer_version: manifest.normalizer_version });
  await writeYamlAtomic(manifestFile, manifest);
  const journalFile = join(home, "normalization-backups", `v6-${timestamp}`, "normalization-journal.yaml");
  const journal = await readYamlUnknown(journalFile) as Record<string, unknown>;
  journal.manifest_hash = manifest.manifest_hash;
  await writeYamlAtomic(journalFile, journal);
}

function hashUnknownForTest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringifyForTest(value)).digest("hex")}`;
}

function stableStringifyForTest(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyForTest(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringifyForTest(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

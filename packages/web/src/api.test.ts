import { describe, expect, it } from "vitest";

import { ApiError, apiRequest, createApiClient, type Fetcher } from "./api.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("apiRequest", () => {
  it("parses success JSON responses", async () => {
    const fetcher: Fetcher = async (input, init) => {
      expect(input).toBe("/api/products");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
      expect(init?.body).toBe(JSON.stringify({ name: "Workbench" }));

      return jsonResponse({ id: "P-123abc", name: "Workbench" });
    };

    await expect(
      apiRequest("/api/products", { method: "POST", body: { name: "Workbench" }, fetcher }),
    ).resolves.toEqual({
      id: "P-123abc",
      name: "Workbench",
    });
  });

  it("throws server API error payloads", async () => {
    const fetcher: Fetcher = async () =>
      jsonResponse(
        {
          error_code: "PRODUCT_NOT_FOUND",
          message: "Missing",
          details: { product_id: "P-missing" },
        },
        { status: 404 },
      );

    await expect(apiRequest("/api/products/P-missing", { fetcher })).rejects.toMatchObject({
      error_code: "PRODUCT_NOT_FOUND",
      message: "Missing",
      details: { product_id: "P-missing" },
      status: 404,
    });
  });

  it("falls back for invalid or empty error bodies", async () => {
    const invalidJsonFetcher: Fetcher = async () =>
      new Response("{", {
        headers: { "Content-Type": "application/json" },
        status: 502,
        statusText: "Bad Gateway",
      });
    const emptyFetcher: Fetcher = async () => new Response(null, { status: 500, statusText: "Server Error" });

    await expect(apiRequest("/api/products", { fetcher: invalidJsonFetcher })).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest("/api/products", { fetcher: invalidJsonFetcher })).rejects.toMatchObject({
      error_code: "HTTP_ERROR",
      message: "Bad Gateway",
      details: {},
      status: 502,
    });
    await expect(apiRequest("/api/products", { fetcher: emptyFetcher })).rejects.toMatchObject({
      error_code: "HTTP_ERROR",
      message: "Server Error",
      details: {},
      status: 500,
    });
  });

  it("rejects invalid typed client success payloads", async () => {
    const client = createApiClient(async () => new Response("<html>not json</html>", { status: 200 }));

    await expect(client.listStyles()).rejects.toMatchObject({
      error_code: "INVALID_RESPONSE",
      message: "Invalid API response",
    });
  });

  it("keeps document payloads on requirement mutations", async () => {
    const requests: Array<{ body?: unknown; input: RequestInfo | URL; method?: string }> = [];
    const client = createApiClient(async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(init.body.toString()) : undefined,
        input,
        method: init?.method,
      });
      const path = input.toString();
      if (path.endsWith("/requirements")) {
        return jsonResponse({
          id: "R-12345678",
          product_id: "P-123abc",
          title: "Checkout",
          status: "empty",
          created_at: "2026-05-17T00:00:00.000Z",
          updated_at: "2026-05-17T00:00:00.000Z",
          pages: [],
          navigation: [],
        });
      }
      if (path.endsWith("/archive")) {
        // New archive response shape: { requirement, icons, vzi }
        return jsonResponse({
          requirement: {
            id: "R-12345678",
            product_id: "P-123abc",
            title: "Checkout",
            status: "archived",
            created_at: "2026-05-17T00:00:00.000Z",
            updated_at: "2026-05-17T00:00:00.000Z",
            pages: [],
            navigation: [],
            document_md: "# Checkout",
          },
          icons: { pages: [], totalIcons: 0 },
          vzi: { pages: [], totalElements: 0 },
        });
      }
      return jsonResponse({
        id: "R-12345678",
        product_id: "P-123abc",
        title: "Checkout",
        status: "submitted",
        created_at: "2026-05-17T00:00:00.000Z",
        updated_at: "2026-05-17T00:00:00.000Z",
        pages: [],
        navigation: [],
        document_md: "# Checkout",
      });
    });

    await expect(
      client.createRequirement("P-123abc", {
        title: "Checkout",
        document_md: "# Checkout",
        pages: [
          {
            page_id: "checkout-page",
            name: "Checkout",
            baseline_page: "checkout",
            declared_fields: [{ key: "email", label: "Email" }],
            declared_actions: [{ key: "submit_payment", label: "Submit payment" }],
            declared_component_keys: ["primary-button"],
          },
          {
            page_id: "profile-page",
            name: "Profile",
            baseline_page: "profile",
            change_type: "patch",
          },
        ],
        navigation: [],
      }),
    ).resolves.toMatchObject({ id: "R-12345678", document_md: "# Checkout" });

    await expect(client.archiveRequirement("P-123abc", "R-12345678")).resolves.toMatchObject({
      requirement: { id: "R-12345678", status: "archived", document_md: "# Checkout" },
      icons: { totalIcons: 0 },
      vzi: { pages: [], totalElements: 0 },
    });
    expect(requests).toEqual([
      {
        input: "/api/products/P-123abc/requirements",
        method: "POST",
        body: { title: "Checkout" },
      },
      {
        input: "/api/products/P-123abc/requirements/R-12345678/save",
        method: "POST",
        body: {
          document_md: "# Checkout",
          navigation: [],
          pages: [
            {
              page_id: "checkout-page",
              name: "Checkout",
              baseline_page: "checkout",
              change_type: "new",
              declared_fields: [{ key: "email", label: "Email" }],
              declared_actions: [{ key: "submit_payment", label: "Submit payment" }],
              declared_component_keys: ["primary-button"],
            },
            {
              page_id: "profile-page",
              name: "Profile",
              baseline_page: "profile",
              change_type: "patch",
            },
          ],
          ui_affected: true,
        },
      },
      {
        input: "/api/products/P-123abc/requirements/R-12345678/archive",
        method: "PUT",
        body: undefined,
      },
    ]);
  });

  it("builds v0.3 product configuration and requirement routes", async () => {
    const requests: Array<{ body?: unknown; input: RequestInfo | URL; method?: string }> = [];
    const client = createApiClient(async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(init.body.toString()) : undefined,
        input,
        method: init?.method,
      });

      const path = input.toString();
      if (path.endsWith("/config")) {
        return jsonResponse({
          id: "P-123abc",
          name: "Workbench",
          description: "Internal tool",
          platform: "web",
          languages: ["zh-CN", "en"],
          default_language: "zh-CN",
        });
      }
      if (path.endsWith("/save")) {
        return jsonResponse({
          id: "R-12345678",
          product_id: "P-123abc",
          title: "Checkout",
          status: "submitted",
          ui_affected: true,
          created_at: "2026-05-17T00:00:00.000Z",
          updated_at: "2026-05-17T00:00:00.000Z",
          pages: [],
          navigation: [],
          document_md: "# Checkout",
        });
      }
      return jsonResponse({
        id: "R-12345678",
        product_id: "P-123abc",
        title: "Checkout",
        status: "empty",
        ui_affected: true,
        created_at: "2026-05-17T00:00:00.000Z",
        updated_at: "2026-05-17T00:00:00.000Z",
        pages: [],
        navigation: [],
      });
    });

    await expect(
      client.configureProduct("P-123abc", {
        platform: "web",
        brand_style: "linear",
        languages: ["zh-CN", "en"],
        default_language: "zh-CN",
      }),
    ).resolves.toMatchObject({ id: "P-123abc", default_language: "zh-CN" });
    await expect(client.createEmptyRequirement("P-123abc", { title: "Checkout" })).resolves.toMatchObject({
      id: "R-12345678",
      status: "empty",
    });
    await expect(
      client.saveRequirement("P-123abc", "R-12345678", {
        document_md: "# Checkout",
        pages: [
          {
            page_id: "checkout-page",
            name: "Checkout",
            baseline_page: "checkout",
            change_type: "patch",
            copy: [{ context: "title", text: "Checkout" }],
            declared_fields: [{ key: "email", label: "Email" }],
            declared_actions: [{ key: "submit_payment", label: "Submit payment" }],
            declared_component_keys: ["primary-button"],
          },
        ],
        navigation: [],
        translations: [
          {
            page_id: "checkout-page",
            entries: [{ context: "title", texts: { en: "Checkout", "zh-CN": "结账" } }],
          },
        ],
        rules: [],
        remove_rule_ids: [],
        remove_page_ids: [],
        ui_affected: true,
      }),
    ).resolves.toMatchObject({ id: "R-12345678", document_md: "# Checkout" });

    expect(requests).toEqual([
      {
        input: "/api/products/P-123abc/config",
        method: "POST",
        body: {
          platform: "web",
          brand_style: "linear",
          languages: ["zh-CN", "en"],
          default_language: "zh-CN",
        },
      },
      {
        input: "/api/products/P-123abc/requirements",
        method: "POST",
        body: { title: "Checkout" },
      },
      {
        input: "/api/products/P-123abc/requirements/R-12345678/save",
        method: "POST",
        body: {
          document_md: "# Checkout",
          pages: [
            {
              page_id: "checkout-page",
              name: "Checkout",
              baseline_page: "checkout",
              change_type: "patch",
              copy: [{ context: "title", text: "Checkout" }],
              declared_fields: [{ key: "email", label: "Email" }],
              declared_actions: [{ key: "submit_payment", label: "Submit payment" }],
              declared_component_keys: ["primary-button"],
            },
          ],
          navigation: [],
          translations: [
            {
              page_id: "checkout-page",
              entries: [{ context: "title", texts: { en: "Checkout", "zh-CN": "结账" } }],
            },
          ],
          rules: [],
          remove_rule_ids: [],
          remove_page_ids: [],
          ui_affected: true,
        },
      },
    ]);
  });

  it("builds baseline page copy routes", async () => {
    const requests: Array<RequestInfo | URL> = [];
    const client = createApiClient(async (input) => {
      requests.push(input);
      return jsonResponse({
        page_id: "checkout",
        default_language_copy: [{ context: "title", text: "结账" }],
        translations: [{ context: "title", texts: { en: "Checkout" } }],
      });
    });

    await expect(client.getPageCopy("P-123abc", "checkout")).resolves.toMatchObject({ page_id: "checkout" });
    await expect(client.getPageCopy("P-123abc", "checkout", "R 123")).resolves.toMatchObject({ page_id: "checkout" });

    expect(requests).toEqual([
      "/api/products/P-123abc/baseline/pages/checkout/copy",
      "/api/products/P-123abc/baseline/pages/checkout/copy?requirement_id=R+123",
    ]);
  });

  it("sends product deletion confirmation and parses cleanup result", async () => {
    const requests: Array<{ body?: unknown; input: RequestInfo | URL; method?: string }> = [];
    const client = createApiClient(async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(init.body.toString()) : undefined,
        input,
        method: init?.method,
      });
      return jsonResponse({
        product_id: "P-123abc",
        deleted: true,
        session_cleared: true,
        cleanup_pending: false,
        recovery_warnings: ["Recovered orphaned requirement index"],
      });
    });

    await expect(client.deleteProduct("P-123abc", { confirm_product_id: "P-123abc" })).resolves.toEqual({
      product_id: "P-123abc",
      deleted: true,
      session_cleared: true,
      cleanup_pending: false,
      recovery_warnings: ["Recovered orphaned requirement index"],
    });

    expect(requests).toEqual([
      {
        input: "/api/products/P-123abc",
        method: "DELETE",
        body: { confirm_product_id: "P-123abc" },
      },
    ]);
  });

  it("does not expose removed legacy design API client methods", () => {
    const client = createApiClient();

    for (const method of [
      "exportDesignAsset",
      "getDesignAnnotations",
      "getDesignDiff",
      "getDesignHistory",
      "getDesignImage",
      "getActiveProductDesignSession",
      "getActiveRequirementDesignSession",
      "getProductComponentLibrary",
      "getRequirementDesignCanvas",
      "getRequirementDesignScene",
      "indexRequirementDesignCanvas",
      "getStylePreview",
      "getSyncStatus",
      "syncStyles",
    ]) {
      expect(method in client).toBe(false);
    }
  });

  it("builds v6 requirement design API routes without design ids", async () => {
    const requests: Array<{ body?: unknown; input: RequestInfo | URL; method?: string }> = [];
    const client = createApiClient(async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(init.body.toString()) : undefined,
        input,
        method: init?.method,
      });
      const path = input.toString();
      if (path.includes("/design/history")) {
        return jsonResponse([{ version: 1, file: "history/canvas/canvas.c1.pen" }]);
      }
      if (path.includes("/design/export")) {
        return jsonResponse({ path: "data/P-123abc/R-12345678/design.pen", revision: "sha256:abc" });
      }
      if (path.includes("/design/diff")) {
        return jsonResponse({ changed: false, from_canvas_version: 1, to_canvas_version: 2 });
      }
      return jsonResponse({ session_id: "S-1234567890abcdef", status: "running" });
    });
    const sessionId = "S-1234567890abcdef";

    await expect(client.getRequirementDesignHistory("P-123abc", "R-12345678", "checkout-page")).resolves.toEqual([
      { version: 1, file: "history/canvas/canvas.c1.pen" },
    ]);
    await expect(
      client.exportRequirementDesignAsset("P-123abc", "R-12345678", { node_id: "frame-1", format: "png" }),
    ).resolves.toMatchObject({
      revision: "sha256:abc",
    });
    await expect(
      client.getRequirementDesignDiff("P-123abc", "R-12345678", {
        page_id: "checkout-page",
        from_page_version: 1,
        to_page_version: 2,
      }),
    ).resolves.toMatchObject({ changed: false });
    await expect(
      client.beginRequirementDesignSession("P-123abc", "R-12345678", {
        operation: "generate",
        page_id: "checkout-page",
      }),
    ).resolves.toMatchObject({
      session_id: sessionId,
    });
    await expect(
      client.applyRequirementDesignOperations("P-123abc", "R-12345678", sessionId, {
        operations: [{ tool: "batch_design", args: { node_id: "frame-1" }, intent: "generate" }],
      }),
    ).resolves.toMatchObject({ status: "running" });
    await expect(
      client.validateRequirementDesignQuality("P-123abc", "R-12345678", sessionId, {
        page_id: "checkout-page",
        frame_id: "frame-1",
      }),
    ).resolves.toMatchObject({ status: "running" });
    await expect(
      client.planRequirementComponentRefresh("P-123abc", "R-12345678", sessionId, {
        version: "latest",
        scope: "all_pages",
      }),
    ).resolves.toMatchObject({ status: "running" });
    await expect(
      client.planImportMetadataNormalization("P-123abc", "R-12345678", sessionId, {
        page_id: "checkout-page",
        frame_id: "frame-1",
      }),
    ).resolves.toMatchObject({ status: "running" });
    await expect(
      client.planRequirementDesignRollback("P-123abc", "R-12345678", sessionId, { canvas_version: 1 }),
    ).resolves.toMatchObject({
      status: "running",
    });
    await expect(
      client.commitRequirementDesignSession("P-123abc", "R-12345678", sessionId, {
        page_id: "checkout-page",
        frame_id: "frame-1",
        quality_report: { status: "passed", hard_checks: { issues: [] }, warnings: [] },
      }),
    ).resolves.toMatchObject({ status: "running" });
    await expect(client.discardRequirementDesignSession("P-123abc", "R-12345678", sessionId)).resolves.toMatchObject({
      status: "running",
    });

    expect(requests).toEqual([
      {
        input: "/api/products/P-123abc/requirements/R-12345678/design/history?page_id=checkout-page",
        method: undefined,
        body: undefined,
      },
      {
        input: "/api/products/P-123abc/requirements/R-12345678/design/export?node_id=frame-1&format=png",
        method: undefined,
        body: undefined,
      },
      {
        input:
          "/api/products/P-123abc/requirements/R-12345678/design/diff?page_id=checkout-page&from_page_version=1&to_page_version=2",
        method: undefined,
        body: undefined,
      },
      {
        input: "/api/products/P-123abc/requirements/R-12345678/design/session/begin",
        method: "POST",
        body: { operation: "generate", page_id: "checkout-page" },
      },
      {
        input: "/api/products/P-123abc/requirements/R-12345678/design/session/S-1234567890abcdef/operations",
        method: "POST",
        body: { operations: [{ tool: "batch_design", args: { node_id: "frame-1" }, intent: "generate" }] },
      },
      {
        input: "/api/products/P-123abc/requirements/R-12345678/design/session/S-1234567890abcdef/quality",
        method: "POST",
        body: { page_id: "checkout-page", frame_id: "frame-1" },
      },
      {
        input:
          "/api/products/P-123abc/requirements/R-12345678/design/session/S-1234567890abcdef/component-refresh/plan",
        method: "POST",
        body: { version: "latest", scope: "all_pages" },
      },
      {
        input:
          "/api/products/P-123abc/requirements/R-12345678/design/session/S-1234567890abcdef/import-metadata-normalization/plan",
        method: "POST",
        body: { page_id: "checkout-page", frame_id: "frame-1" },
      },
      {
        input: "/api/products/P-123abc/requirements/R-12345678/design/session/S-1234567890abcdef/rollback/plan",
        method: "POST",
        body: { canvas_version: 1 },
      },
      {
        input: "/api/products/P-123abc/requirements/R-12345678/design/session/S-1234567890abcdef/commit",
        method: "POST",
        body: {
          page_id: "checkout-page",
          frame_id: "frame-1",
          quality_report: { status: "passed", hard_checks: { issues: [] }, warnings: [] },
        },
      },
      {
        input: "/api/products/P-123abc/requirements/R-12345678/design/session/S-1234567890abcdef/discard",
        method: "POST",
        body: undefined,
      },
    ]);
    expect(JSON.stringify(requests)).not.toContain("design_id");
  });

  it("builds v6 product component API routes", async () => {
    const requests: Array<{ body?: unknown; input: RequestInfo | URL; method?: string }> = [];
    const client = createApiClient(async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(init.body.toString()) : undefined,
        input,
        method: init?.method,
      });
      return jsonResponse({
        product_id: "P-123abc",
        session_id: "S-1234567890abcdef",
        status: "running",
        components: [],
      });
    });

    await client.beginProductComponentSession("P-123abc", {
      operation: "generate",
      seed_components: [{ component_key: "button-primary" }],
    });
    await client.applyProductComponentOperations("P-123abc", "S-1234567890abcdef", {
      operations: [{ tool: "set_variables", args: { primary: "#111111" }, intent: "change_style" }],
    });
    await client.commitProductComponentSession("P-123abc", "S-1234567890abcdef");
    await client.discardProductComponentSession("P-123abc", "S-1234567890abcdef");
    await client.recoverDesignCommitJournal("P-123abc", "S-1234567890abcdef", { scope: "product_component_library" });

    expect(requests).toEqual([
      {
        input: "/api/products/P-123abc/component-library/session/begin",
        method: "POST",
        body: { operation: "generate", seed_components: [{ component_key: "button-primary" }] },
      },
      {
        input: "/api/products/P-123abc/component-library/session/S-1234567890abcdef/operations",
        method: "POST",
        body: { operations: [{ tool: "set_variables", args: { primary: "#111111" }, intent: "change_style" }] },
      },
      {
        input: "/api/products/P-123abc/component-library/session/S-1234567890abcdef/commit",
        method: "POST",
        body: undefined,
      },
      {
        input: "/api/products/P-123abc/component-library/session/S-1234567890abcdef/discard",
        method: "POST",
        body: undefined,
      },
      {
        input: "/api/products/P-123abc/design/session/S-1234567890abcdef/recover-commit-journal",
        method: "POST",
        body: { scope: "product_component_library" },
      },
    ]);
  });

  it("builds artifact API routes", async () => {
    const requests: Array<{ body?: unknown; input: RequestInfo | URL; method?: string }> = [];
    const client = createApiClient(async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(init.body.toString()) : undefined,
        input,
        method: init?.method,
      });
      const path = input.toString();
      if (path.includes("/artifacts/A-abc123")) {
        return jsonResponse({
          manifest: {
            id: "A-abc123",
            kind: "page_design",
            title: "Checkout",
            entry: "index.html",
            status: "ready",
            exports: [],
          },
        });
      }
      return jsonResponse({
        artifacts: [
          {
            id: "A-abc123",
            kind: "page_design",
            title: "Checkout",
            updated_at: "2026-05-28T00:00:00.000Z",
            superseded: false,
          },
        ],
      });
    });

    await expect(client.listProductArtifacts("P-123abc")).resolves.toMatchObject({ artifacts: [{ id: "A-abc123" }] });
    await expect(client.listProductArtifacts("P-123abc", "page_design")).resolves.toMatchObject({
      artifacts: [{ id: "A-abc123" }],
    });
    await expect(client.getProductArtifact("P-123abc", "A-abc123")).resolves.toMatchObject({
      manifest: { id: "A-abc123" },
    });

    expect(client.getArtifactPreviewUrl("P-123abc", "A-abc123", "1x")).toBe(
      "/api/products/P-123abc/artifacts/A-abc123/preview/1x",
    );
    expect(client.getArtifactPreviewUrl("P-123abc", "A-abc123", "2x")).toBe(
      "/api/products/P-123abc/artifacts/A-abc123/preview/2x",
    );

    // BC3: bundle asset URL builder — per-segment encoding mirrors core artifactBundleUrl
    expect(client.getArtifactVersionBundleAssetUrl("P-123abc", "A-abc123", 3, "assets/icon.svg")).toBe(
      "/api/products/P-123abc/artifacts/A-abc123/versions/3/bundle/assets/icon.svg",
    );
    expect(client.getArtifactVersionBundleAssetUrl("P id", "A id", 1, "seg a/seg b")).toBe(
      "/api/products/P%20id/artifacts/A%20id/versions/1/bundle/seg%20a/seg%20b",
    );

    expect(requests[0]).toMatchObject({ input: "/api/products/P-123abc/artifacts", method: undefined });
    expect(requests[1]?.input.toString()).toContain("kind=page_design");
    expect(requests[2]).toMatchObject({ input: "/api/products/P-123abc/artifacts/A-abc123", method: undefined });
  });

  it("listSystemStyles calls GET /api/system-styles and returns array", async () => {
    const systemStyles = [{ name: "material", description: "Material Design", mode: "design-system" as const }];
    const client = createApiClient(async () => jsonResponse(systemStyles));

    await expect(client.listSystemStyles()).resolves.toEqual(systemStyles);
  });

  it("configureProduct sends brand_style and optional system_style", async () => {
    const requests: Array<{ body?: unknown; input: RequestInfo | URL; method?: string }> = [];
    const client = createApiClient(async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(init.body.toString()) : undefined,
        input,
        method: init?.method,
      });
      return jsonResponse({ id: "P-123abc", name: "App", description: "Demo" });
    });

    await client.configureProduct("P-123abc", {
      platform: "web",
      brand_style: "linear-app",
      system_style: "material",
      languages: ["en"],
      default_language: "en",
    });

    expect(requests[0]).toMatchObject({
      input: "/api/products/P-123abc/config",
      method: "POST",
      body: {
        platform: "web",
        brand_style: "linear-app",
        system_style: "material",
        languages: ["en"],
        default_language: "en",
      },
    });
  });
});

import { describe, expect, it } from "vitest";

import { ApiError, apiRequest, createApiClient, type Fetcher } from "./api.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init
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

    await expect(apiRequest("/api/products", { method: "POST", body: { name: "Workbench" }, fetcher })).resolves.toEqual({
      id: "P-123abc",
      name: "Workbench"
    });
  });

  it("throws server API error payloads", async () => {
    const fetcher: Fetcher = async () =>
      jsonResponse(
        {
          error_code: "PRODUCT_NOT_FOUND",
          message: "Missing",
          details: { product_id: "P-missing" }
        },
        { status: 404 }
      );

    await expect(apiRequest("/api/products/P-missing", { fetcher })).rejects.toMatchObject({
      error_code: "PRODUCT_NOT_FOUND",
      message: "Missing",
      details: { product_id: "P-missing" },
      status: 404
    });
  });

  it("falls back for invalid or empty error bodies", async () => {
    const invalidJsonFetcher: Fetcher = async () =>
      new Response("{", {
        headers: { "Content-Type": "application/json" },
        status: 502,
        statusText: "Bad Gateway"
      });
    const emptyFetcher: Fetcher = async () => new Response(null, { status: 500, statusText: "Server Error" });

    await expect(apiRequest("/api/products", { fetcher: invalidJsonFetcher })).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest("/api/products", { fetcher: invalidJsonFetcher })).rejects.toMatchObject({
      error_code: "HTTP_ERROR",
      message: "Bad Gateway",
      details: {},
      status: 502
    });
    await expect(apiRequest("/api/products", { fetcher: emptyFetcher })).rejects.toMatchObject({
      error_code: "HTTP_ERROR",
      message: "Server Error",
      details: {},
      status: 500
    });
  });

  it("rejects invalid typed client success payloads", async () => {
    const client = createApiClient(async () => new Response("<html>not json</html>", { status: 200 }));

    await expect(client.listStyles()).rejects.toMatchObject({
      error_code: "INVALID_RESPONSE",
      message: "Invalid API response"
    });
  });

  it("keeps document payloads on requirement mutations", async () => {
    const requests: Array<[RequestInfo | URL, string | undefined]> = [];
    const client = createApiClient(async (input, init) => {
      requests.push([input, init?.method]);
      return jsonResponse({
        id: "R-12345678",
        product_id: "P-123abc",
        title: "Checkout",
        status: input.toString().endsWith("/archive") ? "archived" : "submitted",
        created_at: "2026-05-17T00:00:00.000Z",
        updated_at: "2026-05-17T00:00:00.000Z",
        pages: [],
        navigation: [],
        document_md: "# Checkout"
      });
    });

    await expect(
      client.createRequirement("P-123abc", {
        title: "Checkout",
        document_md: "# Checkout",
        pages: [{ page_id: "checkout-page", name: "Checkout", baseline_page: "checkout" }],
        navigation: []
      })
    ).resolves.toMatchObject({ id: "R-12345678", document_md: "# Checkout" });

    await expect(client.archiveRequirement("P-123abc", "R-12345678")).resolves.toMatchObject({
      id: "R-12345678",
      status: "archived",
      document_md: "# Checkout"
    });
    expect(requests).toEqual([
      ["/api/products/P-123abc/requirements", "POST"],
      ["/api/products/P-123abc/requirements/R-12345678/archive", "PUT"]
    ]);
  });

  it("builds typed design API routes", async () => {
    const requests: Array<[RequestInfo | URL, string | undefined]> = [];
    const client = createApiClient(async (input, init) => {
      requests.push([input, init?.method]);
      const path = input.toString();
      if (path.endsWith("/annotations")) {
        return jsonResponse([{ id: "root", name: "Root", type: "frame", x: 0, y: 0, width: 100, height: 100 }]);
      }
      if (path.endsWith("/history")) {
        return jsonResponse({
          design_id: "D 123",
          product_id: "P-123abc",
          requirement_id: "R-12345678",
          page_id: "checkout",
          current_version: 2,
          versions: [
            {
              version: 1,
              file: "design.v1.pen",
              preview_file: "preview.v1@2x.png",
              created_at: "2026-05-17T01:00:00.000Z",
              current: false,
              image_url: "/api/designs/D%20123/image/file?version=1"
            }
          ]
        });
      }
      if (path.includes("/diff?")) {
        return jsonResponse({
          added: [],
          removed: [],
          modified: [],
          visual: {
            from_image_url: "/api/designs/D%20123/image/file?version=1",
            to_image_url: "/api/designs/D%20123/image/file?version=2"
          }
        });
      }
      if (path.includes("/image?")) {
        return jsonResponse({
          design_id: "D 123",
          version: 2,
          image_url: "/api/designs/D%20123/image/file?version=2",
          preview_path: "/tmp/preview@2x.png"
        });
      }
      if (path.includes("/export?")) {
        return jsonResponse({
          design_id: "D 123",
          node_id: "node 1",
          format: "svg",
          path: "/tmp/node.svg",
          source: "preview"
        });
      }
      return jsonResponse({}, { status: 404 });
    });

    await expect(client.getDesignAnnotations("D 123")).resolves.toHaveLength(1);
    await expect(client.getDesignHistory("D 123")).resolves.toMatchObject({ current_version: 2 });
    await expect(client.getDesignDiff("D 123", 1, 2)).resolves.toMatchObject({
      visual: {
        from_image_url: "/api/designs/D%20123/image/file?version=1",
        to_image_url: "/api/designs/D%20123/image/file?version=2"
      }
    });
    await expect(client.getDesignImage("D 123", 2)).resolves.toMatchObject({ version: 2 });
    await expect(client.exportDesignAsset("D 123", "node 1", "svg")).resolves.toMatchObject({ format: "svg", node_id: "node 1" });

    expect(requests).toEqual([
      ["/api/designs/D%20123/annotations", undefined],
      ["/api/designs/D%20123/history", undefined],
      ["/api/designs/D%20123/diff?v1=1&v2=2", undefined],
      ["/api/designs/D%20123/image?version=2", undefined],
      ["/api/designs/D%20123/export?node_id=node+1&format=svg", undefined]
    ]);
  });
});

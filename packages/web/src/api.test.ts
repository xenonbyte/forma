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
});

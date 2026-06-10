import { describe, expect, it } from "vitest";

import { routeTable } from "./routes.js";

describe("routeTable", () => {
  it("marks the three canvas routes as full-screen chrome", () => {
    const paths = routeTable.filter((r) => r.chrome === "fullscreen").map((r) => r.path).sort();
    expect(paths).toEqual(
      [
        "/products/:productId/brand",
        "/products/:productId/requirements/:reqId/annotation",
        "/products/:productId/requirements/:reqId/design",
      ].sort(),
    );
  });
});

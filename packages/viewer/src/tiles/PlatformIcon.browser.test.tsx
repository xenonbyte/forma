import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { PlatformIcon } from "./PlatformIcon.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PlatformIcon", () => {
  it("renders an svg with a data-platform marker, defaulting unknown to web", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PlatformIcon platform="mobile" />));
    expect(container.querySelector("svg[data-platform='mobile']")).not.toBeNull();
    act(() => root.render(<PlatformIcon platform={undefined} />));
    expect(container.querySelector("svg[data-platform='web']")).not.toBeNull();
    act(() => root.unmount());
  });
});

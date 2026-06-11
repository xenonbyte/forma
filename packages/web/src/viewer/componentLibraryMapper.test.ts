import { describe, it, expect } from "vitest";
import { mapComponentLibraryUnits } from "./componentLibraryMapper.js";

describe("mapComponentLibraryUnits", () => {
  const base = {
    artifactId: "lib", version: 3, platform: "mobile" as const,
    units: [
      { id: "foundations", title: "Foundations", role: "foundations" as const, entry: "unit-foundations.html", width: 520, height: 720 },
      { id: "button", title: "Button", role: "component" as const, entry: "unit-button.html" },
    ],
  };

  it("maps each unit to an input with its bundlePath, platform, and size", () => {
    const inputs = mapComponentLibraryUnits(base);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      artifactId: "lib", kind: "component-library", pageId: "brand-resources",
      variant: "000-foundations", title: "Foundations", version: 3, bundlePath: "unit-foundations.html",
      platform: "mobile", width: 520, height: 720,
    });
    expect(inputs[1]).toMatchObject({ variant: "001-button", bundlePath: "unit-button.html", width: 390, height: 844 });
  });

  it("orders variants so the horizontal layout follows emit order, not alphabetical", () => {
    const inputs = mapComponentLibraryUnits({
      ...base,
      units: [
        { id: "foundations", title: "Foundations", role: "foundations" as const, entry: "unit-foundations.html" },
        { id: "icon", title: "Icon", role: "icon" as const, entry: "unit-icon.html" },
        { id: "button", title: "Button", role: "component" as const, entry: "unit-button.html" },
      ],
    });
    expect(inputs.map((i) => i.variant)).toEqual(["000-foundations", "001-icon", "002-button"]);
  });

  it("returns empty for no units", () => {
    expect(mapComponentLibraryUnits({ ...base, units: [] })).toEqual([]);
  });
});

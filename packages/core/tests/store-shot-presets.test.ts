/**
 * store-shot-presets.test.ts — PLAN-TASK-024 (M5)
 *
 * The STORE_SHOT_PRESETS table is a curated set of official platform store /
 * sharing image sizes, each carrying a `source` URL and an ISO `verifiedAt`
 * date so the provenance of every pixel value is auditable. These tests pin:
 *   - every preset carries a non-empty source URL + a YYYY-MM-DD verifiedAt,
 *   - the exact verified pixel dimensions (no placeholder values),
 *   - listStoreShotPresets(platform) filters by the documented mapping:
 *       mobile  → iOS + Android phone presets
 *       web     → web Open Graph preset
 *       desktop → web Open Graph preset
 *       tablet  → web Open Graph preset (no tablet-specific size verified)
 *
 * Verified sources (2026-06-13):
 *   - iOS 6.9" screenshot 1320×2868 — App Store Connect screenshot specifications
 *   - Android phone 1080×1920 — Google Play Console preview-asset requirements
 *   - Web Open Graph 1200×630 — ogp.me + Facebook sharing-image recommendation
 *
 * Spec: SPEC-BEHAVIOR-006.
 */

import { describe, expect, it } from "vitest";
import { STORE_SHOT_PRESETS, listStoreShotPresets, type StoreShotPreset } from "@xenonbyte/forma-core";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("STORE_SHOT_PRESETS — verified provenance", () => {
  it("carries the three verified presets keyed by id", () => {
    expect(Object.keys(STORE_SHOT_PRESETS).sort()).toEqual(["android-phone", "ios-6.9", "web-og"]);
  });

  it("every preset has a non-empty https source URL and an ISO verifiedAt date", () => {
    for (const [id, preset] of Object.entries(STORE_SHOT_PRESETS)) {
      expect(preset.id, `${id} self-id`).toBe(id);
      expect(preset.source.length, `${id} source non-empty`).toBeGreaterThan(0);
      expect(preset.source.startsWith("https://"), `${id} source is an https URL`).toBe(true);
      expect(ISO_DATE.test(preset.verifiedAt), `${id} verifiedAt is YYYY-MM-DD`).toBe(true);
      expect(Number.isInteger(preset.width) && preset.width > 0, `${id} width`).toBe(true);
      expect(Number.isInteger(preset.height) && preset.height > 0, `${id} height`).toBe(true);
    }
  });

  it("pins the exact verified pixel dimensions (no placeholder values)", () => {
    expect(STORE_SHOT_PRESETS["ios-6.9"].width).toBe(1320);
    expect(STORE_SHOT_PRESETS["ios-6.9"].height).toBe(2868);
    expect(STORE_SHOT_PRESETS["android-phone"].width).toBe(1080);
    expect(STORE_SHOT_PRESETS["android-phone"].height).toBe(1920);
    expect(STORE_SHOT_PRESETS["web-og"].width).toBe(1200);
    expect(STORE_SHOT_PRESETS["web-og"].height).toBe(630);
  });

  it("each source points at the platform's official documentation host", () => {
    expect(STORE_SHOT_PRESETS["ios-6.9"].source).toContain("developer.apple.com");
    expect(STORE_SHOT_PRESETS["android-phone"].source).toContain("support.google.com");
    // web-og is corroborated by the Open Graph protocol spec + a platform doc;
    // the recorded source is the protocol authority (ogp.me).
    expect(STORE_SHOT_PRESETS["web-og"].source).toContain("ogp.me");
  });
});

describe("listStoreShotPresets — platform → preset mapping", () => {
  function ids(platform: Parameters<typeof listStoreShotPresets>[0]): string[] {
    return listStoreShotPresets(platform)
      .map((p) => p.id)
      .sort();
  }

  it("mobile → iOS + Android phone presets", () => {
    expect(ids("mobile")).toEqual(["android-phone", "ios-6.9"]);
  });

  it("web → the web Open Graph preset", () => {
    expect(ids("web")).toEqual(["web-og"]);
  });

  it("desktop → the web Open Graph preset", () => {
    expect(ids("desktop")).toEqual(["web-og"]);
  });

  it("tablet → the web Open Graph preset (no tablet-specific size verified)", () => {
    expect(ids("tablet")).toEqual(["web-og"]);
  });

  it("returns fresh array instances (callers cannot mutate the table)", () => {
    const a = listStoreShotPresets("mobile");
    const b = listStoreShotPresets("mobile");
    expect(a).not.toBe(b);
    a.length = 0;
    expect(listStoreShotPresets("mobile")).toHaveLength(2);
  });
});

// Keep the type export exercised so the public surface is pinned.
const _preset: StoreShotPreset | undefined = STORE_SHOT_PRESETS["web-og"];
void _preset;

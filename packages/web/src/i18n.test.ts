import { afterEach, describe, expect, it } from "vitest";

import { getInitialLocale, getLocale, messages, setLocale, t, translate, type Locale } from "./i18n.js";

afterEach(() => {
  setLocale("en");
});

describe("i18n", () => {
  it("falls back to English and stores locale changes", () => {
    const storage = new Map<string, string>();
    const localStorageLike = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    };

    expect(getInitialLocale({ localStorage: localStorageLike, navigatorLanguage: "zh-CN" })).toBe("zh");
    setLocale("en", localStorageLike);
    expect(storage.get("forma.locale")).toBe("en");
    expect(getLocale()).toBe("en");
    expect(t("nav.products")).toBe("Products");
  });

  it("prefers stored locale and falls back to English for unknown navigator languages", () => {
    const storage = new Map<string, string>([["forma.locale", "zh"]]);
    const localStorageLike = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    };

    expect(getInitialLocale({ localStorage: localStorageLike, navigatorLanguage: "ja-JP" })).toBe("zh");
    expect(getInitialLocale({ navigatorLanguage: "ja-JP" })).toBe("en");
  });

  it("ignores localStorage-like read and write failures", () => {
    const localStorageLike = {
      getItem: () => {
        throw new Error("storage read blocked");
      },
      setItem: () => {
        throw new Error("storage write blocked");
      }
    };

    expect(getInitialLocale({ localStorage: localStorageLike, navigatorLanguage: "zh-CN" })).toBe("zh");
    expect(() => setLocale("zh", localStorageLike)).not.toThrow();
    expect(getLocale()).toBe("zh");
  });

  it("ignores default window.localStorage access failures", () => {
    const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get: () => ({
        get localStorage() {
          throw new Error("window storage blocked");
        }
      })
    });

    try {
      expect(getInitialLocale({ navigatorLanguage: "zh-CN" })).toBe("zh");
      expect(() => setLocale("en")).not.toThrow();
    } finally {
      if (previousWindowDescriptor) {
        Object.defineProperty(globalThis, "window", previousWindowDescriptor);
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
    }
  });

  it("defines StyleDetail, StylePreview, and StylePicker copy for both locales", () => {
    const keys = [
      "action.backToStyles",
      "action.cancel",
      "action.close",
      "action.confirm",
      "style.detail.designMd",
      "style.detail.designMdEmpty",
      "style.detail.emptyVariables",
      "style.detail.loadingBody",
      "style.detail.loadingTitle",
      "style.detail.previewMetadataUnavailable",
      "style.detail.staticPreview",
      "style.detail.staticPreviewAlt",
      "style.detail.staticPreviewUnavailable",
      "style.detail.unavailableTitle",
      "style.detail.variables",
      "style.preview.live",
      "style.preview.mockAction",
      "style.preview.mockBody",
      "style.preview.mockNav",
      "style.preview.mockTitle",
      "style.preview.palette",
      "style.preview.radius",
      "style.preview.spacing",
      "style.preview.type",
      "style.preview.warnings",
      "stylePicker.candidateList",
      "stylePicker.detailUnavailable",
      "stylePicker.loadingDetail",
      "stylePicker.noResults",
      "stylePicker.platformRequired",
      "stylePicker.searchLabel",
      "stylePicker.searchPlaceholder",
      "stylePicker.selectStyle",
      "stylePicker.selectedSummary",
      "stylePicker.title"
    ];

    for (const locale of ["en", "zh"] satisfies Locale[]) {
      for (const key of keys) {
        expect(messages[locale][key], `${locale} ${key}`).toBeTypeOf("string");
        expect(translate(key, locale), `${locale} ${key}`).not.toBe(key);
      }
    }
  });

  it("defines web admin polish copy for both locales", () => {
    const keys = [
      "action.delete",
      "action.deleteProduct",
      "action.deleting",
      "deleteDialog.confirmLabel",
      "deleteDialog.description",
      "deleteDialog.scope",
      "deleteDialog.title",
      "deleteDialog.typeProductId",
      "product.deleteCleanupPending",
      "product.deleteError",
      "product.deleteRecoveryWarnings",
      "product.deleteSessionCleared",
      "product.deleteSuccess",
      "product.dangerZone",
      "product.dangerZoneHelp",
      "product.emptyIllustration",
      "product.noSystemStyle",
      "product.systemStyle",
      "requirement.emptyIllustration"
    ];

    for (const locale of ["en", "zh"] satisfies Locale[]) {
      for (const key of keys) {
        expect(messages[locale][key], `${locale} ${key}`).toBeTypeOf("string");
        expect(translate(key, locale), `${locale} ${key}`).not.toBe(key);
      }
    }
  });

  it("defines design scene canvas copy for both locales", () => {
    const keys = [
      "action.clearSelection",
      "action.fitPage",
      "action.fitSelection",
      "action.openPreview",
      "action.resetView",
      "action.zoomIn",
      "action.zoomOut",
      "action.zoomOne",
      "design.canvas",
      "design.canvasUnavailable",
      "design.componentLatest",
      "design.componentPinned",
      "design.emptySelection",
      "design.export",
      "design.geometry",
      "design.graphFit",
      "design.graphZoomOne",
      "design.mainCanvas",
      "design.nodeList",
      "design.pencilPath",
      "design.preview",
      "design.previewExpired",
      "design.previewMissing",
      "design.properties",
      "design.rendererWarnings",
      "design.selectedNode",
      "design.session",
      "design.sessionElapsed",
      "design.sessionLockOwner",
      "design.sessionNone",
      "design.sessionOperation",
      "design.sessionPencilPid",
      "design.spacing",
      "design.unsupportedProperties",
      "design.usageIndex",
      "design.view"
    ];

    for (const locale of ["en", "zh"] satisfies Locale[]) {
      for (const key of keys) {
        expect(messages[locale][key], `${locale} ${key}`).toBeTypeOf("string");
        expect(translate(key, locale), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});

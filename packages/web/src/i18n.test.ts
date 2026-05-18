import { describe, expect, it } from "vitest";

import { getInitialLocale, getLocale, setLocale, t } from "./i18n.js";

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
});

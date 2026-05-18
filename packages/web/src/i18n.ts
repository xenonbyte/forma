export type Locale = "en" | "zh";

export const localeStorageKey = "forma.locale";

export const messages: Record<Locale, Record<string, string>> = {
  en: {
    "nav.products": "Products",
    "nav.products.meta": "Sessions and requirements",
    "nav.styles": "Styles",
    "nav.styles.meta": "Design libraries"
  },
  zh: {
    "nav.products": "产品",
    "nav.products.meta": "会话与需求",
    "nav.styles": "样式",
    "nav.styles.meta": "设计库"
  }
};

export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface InitialLocaleOptions {
  localStorage?: LocalStorageLike;
  navigatorLanguage?: string;
}

let currentLocale: Locale = getInitialLocale();

export function t(key: string): string {
  return messages[currentLocale][key] ?? messages.en[key] ?? key;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(next: Locale, localStorageLike: LocalStorageLike | undefined = getDefaultLocalStorage()): void {
  currentLocale = next;
  safeSetItem(localStorageLike, localeStorageKey, next);
}

export function getInitialLocale(options: InitialLocaleOptions = {}): Locale {
  const localStorageLike = options.localStorage ?? getDefaultLocalStorage();
  const stored = safeGetItem(localStorageLike, localeStorageKey);
  if (isLocale(stored)) {
    return stored;
  }

  const navigatorLanguage = options.navigatorLanguage ?? getDefaultNavigatorLanguage();
  return navigatorLanguage.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "zh";
}

function safeGetItem(localStorageLike: LocalStorageLike | undefined, key: string): string | null {
  try {
    return localStorageLike?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSetItem(localStorageLike: LocalStorageLike | undefined, key: string, value: string): void {
  try {
    localStorageLike?.setItem(key, value);
  } catch {
    // Storage can be unavailable in private mode, embedded contexts, or locked-down tests.
  }
}

function getDefaultLocalStorage(): LocalStorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function getDefaultNavigatorLanguage(): string {
  try {
    return typeof navigator === "undefined" ? "" : navigator.language;
  } catch {
    return "";
  }
}

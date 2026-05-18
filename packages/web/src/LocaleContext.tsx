import { createContext, useContext, useState, type ReactNode } from "react";

import { getLocale, setLocale, type Locale } from "./i18n.js";

export interface LocaleContextValue {
  locale: Locale;
  setLocale(next: Locale): void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  function handleSetLocale(next: Locale) {
    setLocale(next);
    setLocaleState(next);
  }

  return <LocaleContext.Provider value={{ locale, setLocale: handleSetLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useLocale must be used within LocaleProvider");
  }

  return value;
}

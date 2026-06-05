import { useLocale } from "../LocaleContext.js";
import type { Locale } from "../i18n.js";

export interface LanguageSwitcherProps {
  ariaLabel?: string;
}

const focusClasses =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

const languageChoices: Array<{ label: string; value: Locale }> = [
  { label: "EN", value: "en" },
  { label: "中", value: "zh" },
];

export function LanguageSwitcher({ ariaLabel = "Language" }: LanguageSwitcherProps) {
  const { locale, setLocale } = useLocale();

  return (
    <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5" aria-label={ariaLabel}>
      {languageChoices.map((choice) => (
        <button
          aria-pressed={locale === choice.value}
          className={`rounded px-2 py-1 text-xs font-semibold transition active:scale-95 ${focusClasses} ${
            locale === choice.value ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
          }`}
          key={choice.value}
          onClick={() => setLocale(choice.value)}
          type="button"
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

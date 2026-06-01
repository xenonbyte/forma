import { useT } from "../LocaleContext.js";
import { LanguageSwitcher } from "../components/LanguageSwitcher.js";

export function Settings() {
  const t = useT();

  return (
    <section className="max-w-xl rounded-lg border border-zinc-200 bg-white shadow-sm" data-settings-panel="language">
      <div className="flex min-h-[72px] items-center justify-between gap-4 px-4">
        <h2 className="text-sm font-semibold tracking-normal text-zinc-950">{t("settings.multilingual")}</h2>
        <LanguageSwitcher ariaLabel={t("settings.multilingual")} />
      </div>
    </section>
  );
}

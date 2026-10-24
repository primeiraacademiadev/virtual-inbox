import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import instance from "./instance";
import { labels, locales, parseLocale, type Locale, type MessageKey } from "./catalog";
type I18n = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
  formatDate: (value: string | Date) => string;
  formatNumber: (value: number) => string;
};
const Context = createContext<I18n | null>(null);
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { t: i18nextT, i18n } = useTranslation();
  const locale = parseLocale(i18n.resolvedLanguage || i18n.language);
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem("virtual-inbox-locale", locale);
    } catch {}
  }, [locale]);
  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale: (next) => {
        void instance.changeLanguage(next);
      },
      t: (key) => String(i18nextT(key)),
      formatDate: (value) =>
        new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(value),
        ),
      formatNumber: (value) => new Intl.NumberFormat(locale).format(value),
    }),
    [locale, i18nextT],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() {
  const value = useContext(Context);
  if (!value) throw Error("LocaleProvider missing");
  return value;
}
export { labels, locales };

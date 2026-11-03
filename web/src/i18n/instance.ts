import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { locales, messages, parseLocale } from "./catalog";
const resources = Object.fromEntries(
  locales.map((locale) => [locale, { translation: messages[locale] }]),
);
function initialLanguage() {
  try {
    const chosen = localStorage.getItem("virtual-inbox-locale");
    if (chosen) return parseLocale(chosen);
  } catch {}
  return parseLocale(navigator.languages?.[0] || navigator.language);
}
void i18next.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: "en",
  supportedLngs: [...locales],
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});
export default i18next;

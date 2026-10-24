export type SearchSection = {
  document: string;
  label: string;
  title: string;
  anchor: string;
  ordinal: number;
  text: string;
};
export type SearchIndex = { version: number; sections: SearchSection[] };
export type SearchResult = SearchSection & { score: number; snippet: string };
import type { Locale } from "../i18n/catalog";
const aliases: Record<Locale, Record<string, string[]>> = {
  "pt-PT": {
    anexo: ["attachment", "ficheiro"],
    ficheiro: ["attachment", "anexo"],
    certificado: ["tls", "ca"],
    esperar: ["wait-for-message", "long polling"],
    telemovel: ["sms", "phone"],
    ssl: ["tls", "smtps"],
    smtp: ["email"],
  },
  en: {
    attachment: ["file", "anexo"],
    certificate: ["tls", "ca"],
    wait: ["wait-for-message", "long polling"],
    phone: ["sms"],
    ssl: ["tls", "smtps"],
    smtp: ["email"],
  },
  fr: {
    piece: ["attachment", "fichier"],
    pieces: ["attachment", "fichier"],
    jointe: ["attachment", "fichier"],
    fichier: ["attachment", "file"],
    boite: ["inbox", "mailbox"],
    attendre: ["wait-for-message"],
    certificat: ["tls", "ca"],
    ssl: ["tls", "smtps"],
    smtp: ["email"],
  },
};
export function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
export function search(
  index: SearchIndex,
  query: string,
  limit = 20,
  locale: Locale = "en",
): SearchResult[] {
  const original = normalize(query);
  if (!original) return [];
  const terms = [
    ...new Set(original.split(/\s+/).flatMap((t) => [t, ...(aliases[locale][t] || [])])),
  ].filter(Boolean);
  return index.sections
    .map((section) => {
      const title = normalize(section.title),
        label = normalize(section.label),
        body = normalize(section.text);
      let score = title.includes(original) ? 35 : 0;
      if (label.includes(original)) score += 12;
      if (body.includes(original)) score += 8;
      for (const term of terms) {
        if (title.includes(term)) score += 12;
        if (label.includes(term)) score += 4;
        if (body.includes(term)) score += 2;
      }
      if (
        section.document === "api" &&
        (/\b(get|post|put|delete)\b/.test(original) || original.includes("/"))
      )
        score += 6;
      const first =
        terms
          .map((t) => body.indexOf(t))
          .filter((n) => n >= 0)
          .sort((a, b) => a - b)[0] ?? 0;
      const start = Math.max(0, first - 65),
        snippet = section.text.slice(start, start + 220);
      return {
        ...section,
        score,
        snippet: (start ? "…" : "") + snippet + (start + 220 < section.text.length ? "…" : ""),
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.document.localeCompare(b.document))
    .slice(0, limit);
}

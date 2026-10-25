import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/context";
import { useDismissable } from "../hooks/useDismissable";
import { search, type SearchIndex, type SearchResult } from "./engine";
import "./search.css";
export type SearchDestination = { document: string; ordinal: number };
export function DocumentSearch({
  onNavigate,
}: {
  onNavigate: (target: SearchDestination) => void;
}) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState<SearchIndex | null>(null),
    [error, setError] = useState("");
  const [scope, setScope] = useState("all"),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const searchRef = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  useEffect(() => {
    let alive = true;
    setIndex(null);
    setError("");
    fetch("/wiki/" + locale + "/search-index.json")
      .then((r) => {
        if (!r.ok) throw Error(t("indexUnavailable"));
        return r.json();
      })
      .then((index) => {
        if (alive) setIndex(index);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [locale, t]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        field.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const results = useMemo(
    () =>
      index
        ? search(
            {
              version: index.version,
              sections: index.sections.filter(
                (s) =>
                  scope === "all" ||
                  (scope === "api"
                    ? s.document === "api"
                    : scope === "settings"
                      ? s.document === "tls"
                      : s.document !== "api" && s.document !== "tls"),
              ),
            },
            query,
            20,
            locale,
          )
        : [],
    [index, query, scope, locale],
  );
  function visit(result: SearchResult) {
    onNavigate({ document: result.document, ordinal: result.ordinal });
    setOpen(false);
  }
  return (
    <div className="docSearch" ref={searchRef}>
      <div className="docSearchBox">
        <input
          ref={field}
          aria-label={t("searchLabel")}
          placeholder={t("search")}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((n) => Math.min(n + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((n) => Math.max(0, n - 1));
            }
            if (e.key === "Enter" && results[selected]) visit(results[selected]);
          }}
        />
        <kbd>Ctrl K</kbd>
      </div>
      {open && (
        <div className="docSearchResults">
          <div className="docSearchFilters">
            {[
              ["all", t("all")],
              ["guide", t("guides")],
              ["api", t("api")],
              ["settings", t("configuration")],
            ].map(([id, label]) => (
              <button key={id} aria-pressed={scope === id} onClick={() => setScope(id)}>
                {label}
              </button>
            ))}
            <button
              className="docSearchClose"
              onClick={() => setOpen(false)}
              aria-label={t("closeSearch")}
            >
              ×
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          {!index && !error && <p>{t("loadingIndex")}</p>}
          {index && query && !results.length && (
            <p>
              {t("noResults")}: “{query}”.
            </p>
          )}
          {index && !query && <p>{t("searchHint")}</p>}
          <div role="listbox" aria-label={t("searchResults")}>
            {results.map((result, i) => (
              <button
                role="option"
                aria-selected={selected === i}
                className={selected === i ? "selected" : ""}
                key={result.document + result.ordinal}
                onClick={() => visit(result)}
              >
                <strong>{result.title}</strong>
                <span>{result.label}</span>
                <small>{result.snippet}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

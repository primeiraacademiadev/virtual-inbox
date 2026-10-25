import { useState } from "react";
import { useDismissable } from "../../hooks/useDismissable";
import type { IdentityPrefs, GenerationOptions } from "./preferences";
import { useI18n } from "../../i18n/context";
import "./identity.css";
const localeOptions = [
  { value: "pt-PT", flag: "🇵🇹", label: "Portugal · pt-PT" },
  { value: "en-US", flag: "🇺🇸", label: "United States · en-US" },
  { value: "fr-FR", flag: "🇫🇷", label: "France · fr-FR" },
];
const emailStrategies = [
  "FIRST_LAST",
  "LAST_FIRST",
  "FIRST_MIDDLE_LAST",
  "FIRST_LAST_SUFFIX",
  "RANDOM",
];
export function IdentityControls({
  channel,
  value,
  onChange,
  options,
}: {
  channel: "email" | "sms";
  value: IdentityPrefs;
  onChange: (next: IdentityPrefs) => void;
  options?: GenerationOptions | null;
}) {
  const { t } = useI18n(),
    [open, setOpen] = useState(false);
  const pickerRef = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const active = localeOptions.find((x) => x.value === value.locale) || localeOptions[0];
  const update = (patch: Partial<IdentityPrefs>) => onChange({ ...value, ...patch });
  return (
    <div className="identityControls" aria-label={t("generationOptions")}>
      <div className="localePicker" ref={pickerRef}>
        <button
          type="button"
          className="localeFlag"
          aria-label={t("identityLocale")}
          aria-expanded={open}
          title={active.label}
          onClick={() => setOpen((x) => !x)}
        >
          {active.flag}
        </button>
        {open && (
          <div className="localeOptions" role="group" aria-label={t("identityLocale")}>
            {localeOptions
              .filter(
                (option) =>
                  !options || options.locales.includes(option.value as IdentityPrefs["locale"]),
              )
              .map((option) => (
                <button
                  type="button"
                  key={option.value}
                  aria-pressed={option.value === value.locale}
                  onClick={() => {
                    update({ locale: option.value as IdentityPrefs["locale"] });
                    setOpen(false);
                  }}
                >
                  {option.flag} {option.label}
                </button>
              ))}
          </div>
        )}
      </div>
      <select
        className="identityStrategy"
        aria-label={t("generationStrategy")}
        title={t("generationStrategy")}
        value={channel === "email" ? value.emailStrategy : value.phoneStrategy}
        onChange={(e) =>
          channel === "email"
            ? update({ emailStrategy: e.target.value })
            : update({ phoneStrategy: e.target.value })
        }
      >
        {(channel === "email"
          ? options?.strategies.email || emailStrategies
          : options?.strategies.sms || ["NATIONAL_FORMAT"]
        ).map((strategy) => (
          <option key={strategy} value={strategy}>
            {t(("strategy_" + strategy) as Parameters<typeof t>[0])}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={"identityToggle" + (value.safeTestData ? " selected" : "")}
        aria-pressed={value.safeTestData}
        title={t("safeTestData")}
        aria-label={t("safeTestData")}
        onClick={() => update({ safeTestData: !value.safeTestData })}
      >
        🛡 <span>SAFE</span>
      </button>
      {channel === "sms" && (
        <button
          type="button"
          className={"identityToggle" + (value.includeCountryCode ? " selected" : "")}
          aria-pressed={value.includeCountryCode}
          title={t("includeCountryCode")}
          aria-label={t("includeCountryCode")}
          onClick={() => update({ includeCountryCode: !value.includeCountryCode })}
        >
          {value.includeCountryCode
            ? { "pt-PT": "+351", "en-US": "+1", "fr-FR": "+33" }[value.locale]
            : t("national")}
        </button>
      )}
    </div>
  );
}

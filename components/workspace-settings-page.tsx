"use client";

import { useMemo, useState } from "react";
import { Building2, CalendarDays, Clock3, Save, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { SUPPORTED_TIMEZONES, dateKeyFor, type SupportedTimezone } from "@/lib/timezone";
import type { WorkspaceSettings } from "@/lib/workspace-settings-repository";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { InlineMessage, StatusBadge, Toast } from "./ui";

export function WorkspaceSettingsPage({ initial }: { initial: WorkspaceSettings }) {
  const { t } = useI18n();
  const preferences = useUserPreferences();
  const [settings, setSettings] = useState(initial);
  const [businessTimezone, setBusinessTimezone] = useState(initial.businessTimezone);
  const [turnstileEnabled, setTurnstileEnabled] = useState(initial.turnstileEnabled);
  const [pending, setPending] = useState(false);
  const [securityPending, setSecurityPending] = useState(false);
  const [error, setError] = useState("");
  const [securityError, setSecurityError] = useState("");
  const [toast, setToast] = useState("");
  const businessDate = useMemo(
    () => dateKeyFor(new Date(), businessTimezone),
    [businessTimezone],
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await apiFetch<{ settings: WorkspaceSettings }>("/api/admin/workspace", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessTimezone }),
      });
      setSettings(response.settings);
      setBusinessTimezone(response.settings.businessTimezone);
      setToast(t("workspaceSettings.saved"));
    } catch (caught) {
      setError(presentApiError(caught, t, "workspaceSettings.saveFailed").message);
    } finally {
      setPending(false);
    }
  };

  const submitSecurity = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSecurityPending(true);
    setSecurityError("");
    try {
      const response = await apiFetch<{ settings: WorkspaceSettings }>("/api/admin/workspace", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnstileEnabled }),
      });
      setSettings(response.settings);
      setTurnstileEnabled(response.settings.turnstileEnabled);
      setToast(t("workspaceSettings.turnstileSaved"));
    } catch (caught) {
      setSecurityError(presentApiError(caught, t, "workspaceSettings.saveFailed").message);
    } finally {
      setSecurityPending(false);
    }
  };

  return <div className="page-stack workspace-settings-page">
    <section className="page-heading-row">
      <div>
        <p className="eyebrow">{t("workspaceSettings.eyebrow")}</p>
        <h1>{t("workspaceSettings.title")}</h1>
        <p>{t("workspaceSettings.description")}</p>
      </div>
      <StatusBadge tone="purple">{t("workspaceSettings.adminOnly")}</StatusBadge>
    </section>
    <section className="quick-summary">
      <span><Building2 size={18}/><b>{settings.name}</b><small>{t("workspaceSettings.organization")}</small></span>
      <span><Clock3 size={18}/><b>{businessTimezone}</b><small>{t("workspaceSettings.businessTimezone")}</small></span>
      <span><CalendarDays size={18}/><b>{businessDate}</b><small>{t("workspaceSettings.businessDate")}</small></span>
      <span><b>{settings.defaultCurrency}</b><small>{t("workspaceSettings.defaultCurrency")}</small></span>
    </section>
    <section className="surface">
      <div className="surface-heading">
        <div>
          <p className="eyebrow">{t("workspaceSettings.calendarEyebrow")}</p>
          <h2>{t("workspaceSettings.businessCalendar")}</h2>
          <p>{t("workspaceSettings.businessCalendarHelp")}</p>
        </div>
        <ShieldCheck size={22}/>
      </div>
      <form onSubmit={submit} aria-busy={pending}>
        <label className="field">
          <span>{t("workspaceSettings.businessTimezone")}</span>
          <select
            value={businessTimezone}
            disabled={pending}
            onChange={(event) => setBusinessTimezone(event.target.value as SupportedTimezone)}
          >
            {SUPPORTED_TIMEZONES.map((timezone) =>
              <option value={timezone} key={timezone}>{timezone}</option>)}
          </select>
          <small>{t("workspaceSettings.timezoneHelp")}</small>
        </label>
        <InlineMessage type="info">
          {t("workspaceSettings.personalDifference", { timezone: preferences.timezone })}
        </InlineMessage>
        <InlineMessage type="warning">{t("workspaceSettings.changeImpact")}</InlineMessage>
        {error && <InlineMessage type="error">{error}</InlineMessage>}
        <div className="drawer-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={pending || businessTimezone === settings.businessTimezone}
          >
            <Save size={16}/>
            {pending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </section>
    <section className="surface">
      <div className="surface-heading">
        <div>
          <p className="eyebrow">{t("workspaceSettings.securityEyebrow")}</p>
          <h2>{t("workspaceSettings.captchaPolicy")}</h2>
          <p>{t("workspaceSettings.captchaPolicyHelp")}</p>
        </div>
        <ShieldCheck size={22}/>
      </div>
      <form onSubmit={submitSecurity} aria-busy={securityPending}>
        <div className="workspace-security-setting">
          <div>
            <b>{t("workspaceSettings.turnstile")}</b>
            <p>{t("workspaceSettings.turnstileHelp")}</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={turnstileEnabled}
              disabled={securityPending}
              aria-label={t("workspaceSettings.turnstile")}
              onChange={(event) => setTurnstileEnabled(event.target.checked)}
            />
            <span/>
          </label>
          <StatusBadge tone={turnstileEnabled ? "green" : "blue"}>
            {t(turnstileEnabled ? "workspaceSettings.turnstileOn" : "workspaceSettings.altchaOn")}
          </StatusBadge>
        </div>
        <InlineMessage type="info">
          {t(turnstileEnabled
            ? "workspaceSettings.turnstileActiveHelp"
            : "workspaceSettings.altchaActiveHelp")}
        </InlineMessage>
        <InlineMessage type="warning">{t("workspaceSettings.cloudflareOneNote")}</InlineMessage>
        {securityError && <InlineMessage type="error">{securityError}</InlineMessage>}
        <div className="drawer-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={securityPending || turnstileEnabled === settings.turnstileEnabled}
          >
            <Save size={16}/>
            {securityPending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </section>
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

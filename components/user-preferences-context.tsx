"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import type { UserSettings } from "@/lib/settings-repository";

type Preferences = Pick<UserSettings, "timezone" | "dateFormat">;
type FormatOptions = { includeTime?: boolean; dateOnly?: boolean };
type UserPreferencesContextValue = Preferences & {
  setPreferences: (preferences: Preferences) => void;
  formatDate: (value: string | number | Date, options?: FormatOptions) => string;
  formatFullDate: (value: string | number | Date) => string;
  todayKey: () => string;
  localDateTimeToIso: (value: string) => string;
  localDateTimeInput: (value?: string | number | Date) => string;
};

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

function partsFor(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function localDateTimeToUtc(value: string, timezone: string) {
  const [date, time = "00:00"] = value.split("T");
  const desired = Date.parse(`${date}T${time}:00Z`);
  let guess = desired;
  for (let index = 0; index < 3; index += 1) {
    const representedParts = partsFor(new Date(guess), timezone);
    const represented = Date.parse(`${representedParts.year}-${representedParts.month}-${representedParts.day}T${representedParts.hour}:${representedParts.minute}:00Z`);
    guess += desired - represented;
  }
  return new Date(guess).toISOString();
}

export function UserPreferencesProvider({
  initialPreferences,
  children,
}: {
  initialPreferences: Preferences;
  children: React.ReactNode;
}) {
  const { locale } = useI18n();
  const [preferences, setPreferences] = useState(initialPreferences);
  const formatDate = useCallback((value: string | number | Date, options: FormatOptions = {}) => {
    const dateOnly = options.dateOnly && typeof value === "string";
    const date = dateOnly ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const timezone = dateOnly ? "UTC" : preferences.timezone;
    const parts = partsFor(date, timezone);
    const formatted = preferences.dateFormat === "dd/MM/yyyy"
      ? `${parts.day}/${parts.month}/${parts.year}`
      : preferences.dateFormat === "MM/dd/yyyy"
        ? `${parts.month}/${parts.day}/${parts.year}`
        : `${parts.year}-${parts.month}-${parts.day}`;
    return options.includeTime ? `${formatted} ${parts.hour}:${parts.minute}` : formatted;
  }, [preferences.dateFormat, preferences.timezone]);
  const formatFullDate = useCallback((value: string | number | Date) => new Intl.DateTimeFormat(
    locale,
    { dateStyle: "full", timeZone: preferences.timezone },
  ).format(new Date(value)), [locale, preferences.timezone]);
  const todayKey = useCallback(() => {
    const parts = partsFor(new Date(), preferences.timezone);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }, [preferences.timezone]);
  const localDateTimeToIso = useCallback(
    (value: string) => localDateTimeToUtc(value, preferences.timezone),
    [preferences.timezone],
  );
  const localDateTimeInput = useCallback((value: string | number | Date = new Date()) => {
    const parts = partsFor(new Date(value), preferences.timezone);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }, [preferences.timezone]);
  const context = useMemo(() => ({
    ...preferences,
    setPreferences,
    formatDate,
    formatFullDate,
    todayKey,
    localDateTimeToIso,
    localDateTimeInput,
  }), [formatDate, formatFullDate, localDateTimeInput, localDateTimeToIso, preferences, todayKey]);
  return <UserPreferencesContext.Provider value={context}>{children}</UserPreferencesContext.Provider>;
}

export function useUserPreferences() {
  const context = useContext(UserPreferencesContext);
  if (!context) throw new Error("useUserPreferences must be used inside UserPreferencesProvider");
  return context;
}

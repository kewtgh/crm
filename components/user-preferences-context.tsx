"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import type { UserSettings } from "@/lib/settings-repository";
import {
  dateTimePartsFor,
  localDateTimeKey,
  zonedLocalDateTimeToUtc,
} from "@/lib/timezone";

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
    const parts = dateTimePartsFor(date, timezone);
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
    const parts = dateTimePartsFor(new Date(), preferences.timezone);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }, [preferences.timezone]);
  const localDateTimeToIso = useCallback(
    (value: string) => zonedLocalDateTimeToUtc(value, preferences.timezone).toISOString(),
    [preferences.timezone],
  );
  const localDateTimeInput = useCallback((value: string | number | Date = new Date()) => {
    return localDateTimeKey(new Date(value), preferences.timezone);
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

import { databaseJson } from "./db/gateway";
import type { AppUser } from "./user";
import { DEFAULT_TIMEZONE, normalizeTimezone, type SupportedTimezone } from "./timezone";

export type NotificationPreferences = Record<string, { email: boolean; inApp: boolean }>;

export type UserSettings = {
  username: string;
  displayNameZh: string;
  displayNameEn: string;
  honorific: string;
  bio: string;
  avatarPath: string | null;
  locale: "zh-CN" | "en";
  timezone: SupportedTimezone;
  dateFormat: "yyyy-MM-dd" | "dd/MM/yyyy" | "MM/dd/yyyy";
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  notifications: NotificationPreferences;
};

type ProfileRow = { username: string; display_name_zh: string; display_name_en: string };
type PreferenceRow = {
  honorific: string; bio: string; avatar_path: string | null; locale: "zh-CN" | "en";
  timezone: string; date_format: UserSettings["dateFormat"]; quiet_hours_start: string | null;
  quiet_hours_end: string | null; notifications: NotificationPreferences;
};

const defaultNotifications: NotificationPreferences = {
  tasks: { email: true, inApp: true }, relationship: { email: true, inApp: true },
  sales: { email: false, inApp: true }, security: { email: true, inApp: true },
};

export function normalizeNotificationPreferences(input: NotificationPreferences | null | undefined): NotificationPreferences {
  const normalized = Object.fromEntries(Object.entries(defaultNotifications).map(([key, fallback]) => {
    const candidate = input?.[key];
    return [key, {
      email: typeof candidate?.email === "boolean" ? candidate.email : fallback.email,
      inApp: typeof candidate?.inApp === "boolean" ? candidate.inApp : fallback.inApp,
    }];
  })) as NotificationPreferences;
  if (!normalized.security.email && !normalized.security.inApp) normalized.security.inApp = true;
  return normalized;
}

export async function loadUserSettings(user: AppUser): Promise<UserSettings> {
  const [profiles, preferences] = await Promise.all([
    databaseJson<ProfileRow[]>(`/db/table/user_profiles?select=username,display_name_zh,display_name_en&user_id=eq.${user.id}&limit=1`),
    databaseJson<PreferenceRow[]>(`/db/table/user_preferences?select=honorific,bio,avatar_path,locale,timezone,date_format,quiet_hours_start,quiet_hours_end,notifications&user_id=eq.${user.id}&limit=1`),
  ]);
  const profile = profiles[0];
  const preference = preferences[0];
  return {
    username: profile?.username ?? user.username,
    displayNameZh: profile?.display_name_zh ?? user.displayNameZh,
    displayNameEn: profile?.display_name_en ?? user.displayName,
    honorific: preference?.honorific ?? "",
    bio: preference?.bio ?? "",
    avatarPath: preference?.avatar_path ?? null,
    locale: preference?.locale ?? "zh-CN",
    timezone: normalizeTimezone(preference?.timezone ?? DEFAULT_TIMEZONE),
    dateFormat: preference?.date_format ?? "yyyy-MM-dd",
    quietHoursStart: preference?.quiet_hours_start ?? null,
    quietHoursEnd: preference?.quiet_hours_end ?? null,
    notifications: normalizeNotificationPreferences(preference?.notifications),
  };
}

export async function updateProfile(userId: string, input: Pick<UserSettings, "displayNameZh" | "displayNameEn" | "honorific" | "bio">) {
  await Promise.all([
    databaseJson(`/db/table/user_profiles?user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ display_name_zh: input.displayNameZh, display_name_en: input.displayNameEn, updated_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } }),
    databaseJson(`/db/table/user_preferences?user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ honorific: input.honorific, bio: input.bio, updated_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } }),
  ]);
}

export async function updateAccount(userId: string, input: Pick<UserSettings, "locale" | "timezone" | "dateFormat">) {
  await databaseJson(`/db/table/user_preferences?user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ locale: input.locale, timezone: input.timezone, date_format: input.dateFormat, updated_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
}

export async function updateLocale(userId: string, locale: UserSettings["locale"]) {
  await databaseJson(`/db/table/user_preferences?user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ locale, updated_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
}

export async function updateNotifications(userId: string, notifications: NotificationPreferences, quietHoursStart: string | null, quietHoursEnd: string | null) {
  await databaseJson(`/db/table/user_preferences?user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ notifications: normalizeNotificationPreferences(notifications), quiet_hours_start: quietHoursStart, quiet_hours_end: quietHoursEnd, updated_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
}

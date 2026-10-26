"use client";
import Link from "next/link";
import {useUserPreferences} from "./user-preferences-context";
import {useI18n} from "./i18n-provider";
import {InlineMessage} from "./ui";
export function PreferencesUnavailableNotice(){
 const {available}=useUserPreferences(),{t}=useI18n();
 return available?null:<InlineMessage type="warning">{t("personalSettings.preferencesUnavailable")} <Link href="/settings/account">{t("settings.accountLanguage")}</Link></InlineMessage>;
}

"use client";
import { useI18n } from "./i18n-provider";

/** AUTO is a creation instruction; the database allocates the persisted number. */
export function AutomaticRecordNumber({ name }: { name: string }) {
  const { locale } = useI18n();
  return <><input type="hidden" name={name} value="AUTO"/><span className="automatic-record-number">{locale === "en" ? "Assigned automatically when saved" : "保存时自动分配编号"}</span></>;
}

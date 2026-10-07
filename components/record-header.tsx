"use client";
import type { ReactNode } from "react";
import { localeIdentity } from "@/lib/ux-presentation";
import { useI18n } from "./i18n-provider";

export function RecordIdentity({ nameZh, nameEn }: { nameZh?: string | null; nameEn?: string | null }) {
  const { locale } = useI18n();
  const identity = localeIdentity(locale, nameZh, nameEn);
  return <span className="ux-record-identity"><b>{identity.primary}</b>{identity.alternate && <small>{identity.alternate}</small>}</span>;
}
export function RecordHeader({ nameZh, nameEn, context, status, primaryAction, secondaryActions }: {
  nameZh?: string | null; nameEn?: string | null; context?: ReactNode; status?: ReactNode; primaryAction?: ReactNode; secondaryActions?: ReactNode;
}) {
  const { locale } = useI18n();
  const identity = localeIdentity(locale, nameZh, nameEn);
  return <header className="ux-record-header"><div><h1>{identity.primary}</h1>{identity.alternate && <p className="ux-alternate-identity">{identity.alternate}</p>}{context && <div className="ux-record-context">{context}</div>}{status}</div><div className="ux-record-actions">{secondaryActions}{primaryAction}</div></header>;
}

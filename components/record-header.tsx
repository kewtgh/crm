"use client";
import type { ReactNode } from "react";
import { localeIdentity } from "@/lib/ux-presentation";
import { useI18n } from "./i18n-provider";

export function RecordIdentity({ nameZh, nameEn }: { nameZh?: string | null; nameEn?: string | null }) {
  const { locale } = useI18n();
  const identity = localeIdentity(locale, nameZh, nameEn);
  return <span className="ux-record-identity"><b>{identity.primary}</b>{identity.alternate && <small>{identity.alternate}</small>}</span>;
}
export function RecordHeader({ nameZh, nameEn, context, status, primaryAction, secondaryActions, breadcrumb, avatar, moreActions }: {
  nameZh?: string | null; nameEn?: string | null; context?: ReactNode; status?: ReactNode; primaryAction?: ReactNode; secondaryActions?: ReactNode; breadcrumb?: ReactNode; avatar?: ReactNode; moreActions?: ReactNode;
}) {
  const { locale, t } = useI18n();
  const identity = localeIdentity(locale, nameZh, nameEn);
  return <header className="ux-record-header">{breadcrumb && <nav className="ux-record-breadcrumb" aria-label={t("workspace.breadcrumb")}>{breadcrumb}</nav>}<div className="ux-record-heading">{avatar && <span className="ux-record-avatar" aria-hidden="true">{avatar}</span>}<div className="ux-record-heading-text"><div className="ux-record-title"><h1>{identity.primary}</h1>{status}</div>{identity.alternate && <p className="ux-alternate-identity">{identity.alternate}</p>}{context && <div className="ux-record-context">{context}</div>}</div></div><div className="ux-record-actions">{primaryAction}{secondaryActions && <div className="ux-record-secondary">{secondaryActions}</div>}{moreActions}</div></header>;
}

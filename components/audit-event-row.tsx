"use client";

import { useI18n } from "@/components/i18n-provider";
import { useUserPreferences } from "@/components/user-preferences-context";
import type { AdminAuditEvent } from "@/lib/admin-dashboard-repository";
import { auditLabel } from "@/lib/audit-presentation";

export function AuditEventRow({ event }: { event: AdminAuditEvent }) {
  const { locale, t } = useI18n();
  const { formatDate } = useUserPreferences();
  const actor = event.actorZh && event.actorEn
    ? `${event.actorZh} / ${event.actorEn}`
    : t("admin.systemActor");
  const date = formatDate(event.createdAt, { includeTime: true });

  return (
    <div className="event-row">
      <i className="blue" />
      <span>
        <b>{auditLabel(event.action, locale)} · {auditLabel(event.entityType, locale)}</b>
        <small>{actor}{event.entityId ? ` · ${event.entityId.slice(0, 8)}` : ""} · {date}</small>
        <details className="audit-technical-details">
          <summary>{t("admin.technicalDetails")}</summary>
          <code className="audit-technical-label">{event.action} · {event.entityType}</code>
        </details>
      </span>
    </div>
  );
}

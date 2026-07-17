"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";
import { useI18n } from "./i18n-provider";

export function DataLoadError({ detailKey = "common.dataLoadError" }: { detailKey?: string }) {
  const { t } = useI18n();
  return (
    <section className="surface data-state" role="alert">
      <span className="data-state-icon"><AlertTriangle size={24} /></span>
      <div>
        <h1>{t("common.dataUnavailable")}</h1>
        <p>{t(detailKey)}</p>
      </div>
      <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
        <RefreshCcw size={16} />{t("common.retry")}
      </button>
    </section>
  );
}

export function EmptyState({ messageKey = "common.noData" }: { messageKey?: string }) {
  const { t } = useI18n();
  return <div className="empty-state" role="status"><span>{t(messageKey)}</span></div>;
}

"use client";

import { useState } from "react";
import { CheckCircle2, Download, Plus, ScanSearch, SlidersHorizontal, X } from "lucide-react";
import type { ModuleConfig } from "@/lib/crm-data";
import { DataTable } from "@/components/data-table";
import { InlineMessage, SearchableSelect, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";

const ownerOptions = [
  { value: "olivia", label: "陈雅雯 · Olivia Chen", detail: "系统管理员 · 上海团队" },
  { value: "jason", label: "吴俊杰 · Jason Wu", detail: "销售 · 台北团队" },
  { value: "sophia", label: "林书妍 · Sophia Lin", detail: "顾问 · 新加坡团队" },
  { value: "ethan", label: "王以恒 · Ethan Wang", detail: "运营 · 上海团队" },
  { value: "jasmine", label: "徐嘉敏 · Jasmine Hsu", detail: "客户成功 · 上海团队" },
  { value: "wayne", label: "林韦廷 · Wayne Lin", detail: "销售 · 台北团队" },
  { value: "simon", label: "高思远 · Simon Gao", detail: "运营 · 上海团队" },
  { value: "erin", label: "叶依晨 · Erin Yeh", detail: "销售 · 新加坡团队" },
];

export function ModulePage({ config }: { config: ModuleConfig }) {
  const { t } = useI18n();
  const prefix = `modules.${config.key}`;
  const [drawer, setDrawer] = useState(false);
  const [owner, setOwner] = useState("");
  const [duplicateChecked, setDuplicateChecked] = useState(false);
  const [toast, setToast] = useState("");
  const close = () => { setDrawer(false); setDuplicateChecked(false); setOwner(""); };
  return <div className="page-stack module-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t(`${prefix}.eyebrow`)}</p><h1>{t(`${prefix}.title`)}</h1><p>{t(`${prefix}.description`)}</p></div><div className="page-actions"><button className="secondary-button" type="button"><Download size={16} />{t("modules.export")}</button><button className="primary-button" type="button" onClick={() => setDrawer(true)}><Plus size={17} />{t(`${prefix}.add`)}</button></div></section>
    <section className="quick-summary"><span><b>{config.rows.length}</b><small>{t("modules.allRecords")}</small></span><span><b>{config.rows.filter((row) => row.statusTone === "red" || row.statusTone === "amber").length}</b><small>{t("modules.needsAttention")}</small></span><span><b>{Math.round(config.rows.reduce((sum, row) => sum + row.completeness, 0) / config.rows.length)}%</b><small>{t("modules.averageCompleteness")}</small></span><button type="button"><SlidersHorizontal size={16} />{t("modules.savedViews")}</button></section>
    <DataTable config={config} />
    {drawer && <>
      <button className="drawer-overlay" type="button" aria-label={t("common.close")} onClick={close} />
      <aside className="record-drawer" aria-label={t("modules.createRecord",{record:t(`${prefix}.singular`)})}>
        <div className="drawer-heading"><div><p className="eyebrow">CREATE RECORD</p><h2>{t("modules.createRecord",{record:t(`${prefix}.singular`)})}</h2><p>{t("modules.createHelp")}</p></div><button className="icon-button" type="button" aria-label={t("common.close")} onClick={close}><X size={20} /></button></div>
        <form onSubmit={(event) => { event.preventDefault(); if (!duplicateChecked) return; close(); setToast(`${config.singular}已创建，审计记录已保存`); }}>
          <div className="form-grid two-column"><label className="field"><span>{t("products.nameZh")} <b>*</b></span><input name="nameZh" required placeholder="例：林俊佑" /></label><label className="field"><span>{t("products.nameEn")} <b>*</b></span><input name="nameEn" required placeholder="e.g. Lumina International" /></label></div>
          <label className="field"><span>{t("modules.contact")}</span><input name="contact" placeholder={t("modules.duplicatePlaceholder")} /></label>
          <SearchableSelect label={t("common.owner")} options={ownerOptions} value={owner} onChange={setOwner} placeholder={t("modules.ownerSearch")} />
          <div className="duplicate-check"><div><span><ScanSearch size={18} /></span><div><b>{t("modules.duplicateTitle")}</b><p>{t("modules.duplicateHelp")}</p></div></div>{duplicateChecked ? <InlineMessage type="success">{t("modules.duplicateClear")}</InlineMessage> : <button className="secondary-button" type="button" onClick={() => setDuplicateChecked(true)}><ScanSearch size={16} />{t("modules.checkNow")}</button>}</div>
          {!duplicateChecked && <InlineMessage type="warning">{t("modules.checkRequired")}</InlineMessage>}
          <div className="drawer-actions"><button className="secondary-button" type="button" onClick={close}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={!duplicateChecked}><CheckCircle2 size={17} />{t("modules.createRecord",{record:t(`${prefix}.singular`)})}</button></div>
        </form>
      </aside>
    </>}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

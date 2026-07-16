"use client";

import { useState } from "react";
import { CheckCircle2, Download, Plus, ScanSearch, SlidersHorizontal, X } from "lucide-react";
import type { ModuleConfig } from "@/lib/crm-data";
import { DataTable } from "@/components/data-table";
import { InlineMessage, SearchableSelect, Toast } from "@/components/ui";

const ownerOptions = [
  { value: "olivia", label: "陈雅雯 · Olivia Chen", detail: "系统管理员 · 上海团队" },
  { value: "jason", label: "吴俊杰 · Jason Wu", detail: "销售 · 台北团队" },
  { value: "sophia", label: "林书妍 · Sophia Lin", detail: "顾问 · 新加坡团队" },
  { value: "ethan", label: "王以恒 · Ethan Wang", detail: "运营 · 上海团队" },
  { value: "jasmine", label: "徐嘉敏 · Jasmine Hsu", detail: "导师 · 数学" },
  { value: "wayne", label: "林韦廷 · Wayne Lin", detail: "导师 · 经济" },
  { value: "simon", label: "高思远 · Simon Gao", detail: "导师 · 升学规划" },
  { value: "erin", label: "叶依晨 · Erin Yeh", detail: "导师 · 英文写作" },
];

export function ModulePage({ config }: { config: ModuleConfig }) {
  const [drawer, setDrawer] = useState(false);
  const [owner, setOwner] = useState("");
  const [duplicateChecked, setDuplicateChecked] = useState(false);
  const [toast, setToast] = useState("");
  const close = () => { setDrawer(false); setDuplicateChecked(false); setOwner(""); };
  return <div className="page-stack module-page">
    <section className="page-heading-row"><div><p className="eyebrow">{config.eyebrow}</p><h1>{config.title}</h1><p>{config.description}</p></div><div className="page-actions"><button className="secondary-button" type="button"><Download size={16} />导出</button><button className="primary-button" type="button" onClick={() => setDrawer(true)}><Plus size={17} />{config.addLabel}</button></div></section>
    <section className="quick-summary"><span><b>{config.rows.length}</b><small>全部记录</small></span><span><b>{config.rows.filter((row) => row.statusTone === "red" || row.statusTone === "amber").length}</b><small>需要关注</small></span><span><b>{Math.round(config.rows.reduce((sum, row) => sum + row.completeness, 0) / config.rows.length)}%</b><small>平均完整度</small></span><button type="button"><SlidersHorizontal size={16} />管理保存视图</button></section>
    <DataTable config={config} />
    {drawer && <>
      <button className="drawer-overlay" type="button" aria-label="关闭" onClick={close} />
      <aside className="record-drawer" aria-label={`新建${config.singular}`}>
        <div className="drawer-heading"><div><p className="eyebrow">CREATE RECORD</p><h2>新建{config.singular}</h2><p>先录入识别信息，保存前会自动查重。</p></div><button className="icon-button" type="button" onClick={close}><X size={20} /></button></div>
        <form onSubmit={(event) => { event.preventDefault(); if (!duplicateChecked) return; close(); setToast(`${config.singular}已创建，审计记录已保存`); }}>
          <div className="form-grid two-column"><label className="field"><span>中文名称 <b>*</b></span><input name="nameZh" required placeholder={config.singular === "学生" || config.singular === "联系人" ? "例：林俊佑" : `例：启明${config.singular}`} /></label><label className="field"><span>English name <b>*</b></span><input name="nameEn" required placeholder="e.g. Lumina International" /></label></div>
          <label className="field"><span>邮箱或主要联系方式</span><input name="contact" placeholder="用于精确查重" /></label>
          <SearchableSelect label="负责人 / Owner" options={ownerOptions} value={owner} onChange={setOwner} placeholder="输入姓名搜索负责人" />
          <div className="duplicate-check"><div><span><ScanSearch size={18} /></span><div><b>保存前检查可能重复项</b><p>比较标准化姓名、邮箱、电话和关联机构，不会因同名自动合并。</p></div></div>{duplicateChecked ? <InlineMessage type="success">查重完成：未发现高置信重复项，可安全创建。</InlineMessage> : <button className="secondary-button" type="button" onClick={() => setDuplicateChecked(true)}><ScanSearch size={16} />立即查重</button>}</div>
          {!duplicateChecked && <InlineMessage type="warning">请先完成查重。系统会显示命中规则，由你决定创建或合并。</InlineMessage>}
          <div className="drawer-actions"><button className="secondary-button" type="button" onClick={close}>取消</button><button className="primary-button" type="submit" disabled={!duplicateChecked}><CheckCircle2 size={17} />创建{config.singular}</button></div>
        </form>
      </aside>
    </>}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

"use client";

import { useCallback, useState } from "react";
import { BadgeDollarSign, ChartSpline, Plus, Route, Target } from "lucide-react";
import { AccessibleDrawer, InlineMessage, SearchableSelect, StatusBadge, Toast } from "./ui";
import { useI18n } from "./i18n-provider";
import { apiFetch } from "@/lib/api-client";
import type { GrowthSnapshot } from "@/lib/v220-repository";

type Drawer = "campaign" | "attribution" | "journey";

export function GrowthWorkspace({ initial }: { initial: GrowthSnapshot }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState(initial);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [lead, setLead] = useState("");
  const [leadOptions, setLeadOptions] = useState<Array<{ value: string; label: string; detail: string }>>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const searchLeads = useCallback(async (query: string) => {
    const result = await apiFetch<{ items: Array<{ id: string; nameZh: string; nameEn: string; source: string }> }>(
      `/api/leads?q=${encodeURIComponent(query)}&pageSize=20`,
    ).catch(() => ({ items: [] }));
    setLeadOptions(result.items.map((item) => ({
      value: item.id,
      label: locale === "zh-CN" ? item.nameZh : item.nameEn,
      detail: item.source,
    })));
  }, [locale]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let body: Record<string, unknown>;
    if (drawer === "campaign") {
      body = {
        operation: "campaign", code: form.get("code"), nameZh: form.get("nameZh"), nameEn: form.get("nameEn"),
        channel: form.get("channel"), status: form.get("status"), budget: Number(form.get("budget")),
        currency: String(form.get("currency")).toUpperCase(), startsOn: form.get("startsOn") || null,
        endsOn: form.get("endsOn") || null,
      };
    } else if (drawer === "attribution") {
      body = {
        operation: "attribution", leadId: lead, campaignId: form.get("campaignId") || null,
        touchType: form.get("touchType"), channel: form.get("channel"), source: form.get("source"),
        medium: form.get("medium"), content: form.get("content"),
      };
    } else {
      body = {
        operation: "journey", leadId: lead, stage: form.get("stage"), probability: Number(form.get("probability")),
        nextAction: form.get("nextAction"),
        nextActionAt: form.get("nextActionAt") ? new Date(String(form.get("nextActionAt"))).toISOString() : null,
      };
    }
    setPending(true); setError("");
    try {
      const result = await apiFetch<{ data: GrowthSnapshot }>("/api/growth", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      setData(result.data); setDrawer(null); setLead(""); setToast(t("growth.saved"));
    } catch { setError(t("growth.failed")); }
    finally { setPending(false); }
  };

  return <div className="page-stack v220-workspace">
    <section className="page-heading-row"><div><p className="eyebrow">{t("growth.eyebrow")}</p><h1>{t("growth.title")}</h1><p>{t("growth.help")}</p></div><div className="page-actions"><button className="secondary-button" onClick={() => setDrawer("attribution")}><Target size={16}/>{t("growth.recordTouch")}</button><button className="secondary-button" onClick={() => setDrawer("journey")}><Route size={16}/>{t("growth.journey")}</button><button className="primary-button" onClick={() => setDrawer("campaign")}><Plus size={16}/>{t("growth.newCampaign")}</button></div></section>
    {error && !drawer && <InlineMessage type="error">{error}</InlineMessage>}
    <section className="v220-summary-grid"><article className="surface"><ChartSpline/><b>{data.summary.activeCampaigns}</b><span>{t("growth.activeCampaigns")}</span></article><article className="surface"><Target/><b>{data.summary.attributedLeads}</b><span>{t("growth.attributedLeads")}</span></article><article className="surface"><BadgeDollarSign/><b>{data.summary.convertedLeads}</b><span>{t("growth.converted")}</span></article><article className="surface"><Route/><b>{data.summary.pendingAdmissions}</b><span>{t("growth.pendingAdmissions")}</span></article></section>
    <section className="surface"><div className="surface-heading"><h2>{t("growth.campaigns")}</h2></div><div className="v220-card-grid">{data.campaigns.map((item) => {const won=Number(item.wonByCurrency[item.currency]??0);const roi=item.budget>0?((won-item.budget)/item.budget)*100:null;return <article key={item.id}><div><b>{locale === "zh-CN" ? item.nameZh : item.nameEn}</b><small>{item.code} · {item.channel}</small></div><StatusBadge tone={item.status === "ACTIVE" ? "green" : "amber"}>{item.status}</StatusBadge><strong>{formatMoney(locale,item.budget,item.currency)}</strong><p>{t("growth.campaignMetrics", { touches: item.touches, leads: item.leads, converted: item.converted })}</p><dl className="campaign-performance"><div><dt>{t("growth.pipeline")}</dt><dd>{formatCurrencyMap(locale,item.pipelineByCurrency)}</dd></div><div><dt>{t("growth.won")}</dt><dd>{formatCurrencyMap(locale,item.wonByCurrency)}</dd></div><div><dt>{t("growth.enrolled")}</dt><dd>{item.enrolled}</dd></div><div><dt>{t("growth.roi")}</dt><dd>{roi===null?t("common.notAvailable"):`${roi.toFixed(1)}%`}</dd></div></dl></article>;})}</div>{!data.campaigns.length && <div className="empty-state"><span>{t("growth.empty")}</span></div>}</section>
    <section className="surface"><div className="surface-heading"><h2>{t("growth.journeys")}</h2></div><div className="v220-list">{data.journeys.map((item) => <article key={item.id}><span className="product-icon"><Route size={18}/></span><div><b>{locale === "zh-CN" ? item.nameZh : item.nameEn}</b><small>{item.nextAction || t("pipeline.nextNeeded")}</small></div><StatusBadge tone="blue">{item.stage}</StatusBadge><strong>{item.probability}%</strong></article>)}</div></section>
    {drawer && <AccessibleDrawer title={t(`growth.drawer.${drawer}`)} onClose={() => { setDrawer(null); setError(""); }}>
      <form onSubmit={submit}>
        {drawer === "campaign" ? <CampaignFields t={t}/> : <>
          <SearchableSelect label={t("growth.lead")} value={lead} options={leadOptions} onChange={setLead} onSearch={searchLeads}/>
          {drawer === "attribution" ? <AttributionFields data={data} locale={locale} t={t}/> : <JourneyFields t={t}/>} 
        </>}
        {error && <InlineMessage type="error">{error}</InlineMessage>}
        <div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setDrawer(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending || ((drawer === "attribution" || drawer === "journey") && !lead)}>{pending ? t("common.saving") : t("common.save")}</button></div>
      </form>
    </AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>} 
  </div>;
}

type Translate=(key:string,values?:Record<string,string|number>)=>string;
function CampaignFields({t}:{t:Translate}){return <><div className="form-grid two-column"><label className="field"><span>{t("growth.code")}</span><input name="code" required/></label><label className="field"><span>{t("growth.channel")}</span><input name="channel" required/></label></div><div className="form-grid two-column"><label className="field"><span>{t("education.nameZh")}</span><input name="nameZh" required/></label><label className="field"><span>{t("education.nameEn")}</span><input name="nameEn" required/></label></div><div className="form-grid two-column"><label className="field"><span>{t("growth.budget")}</span><input name="budget" type="number" min="0" defaultValue="0" required/></label><label className="field"><span>{t("pipeline.currency")}</span><input name="currency" defaultValue="CNY" pattern="[A-Za-z]{3}" required/></label></div><div className="form-grid two-column"><label className="field"><span>{t("contracts.startDate")}</span><input name="startsOn" type="date"/></label><label className="field"><span>{t("contracts.endDate")}</span><input name="endsOn" type="date"/></label></div><label className="field"><span>{t("common.status")}</span><select name="status" defaultValue="PLANNED">{["PLANNED","ACTIVE","PAUSED","COMPLETED"].map((value) => <option key={value}>{value}</option>)}</select></label></>}
function AttributionFields({data,locale,t}:{data:GrowthSnapshot;locale:string;t:Translate}){return <><label className="field"><span>{t("growth.campaign")}</span><select name="campaignId" defaultValue=""><option value="">{t("common.none")}</option>{data.campaigns.map((item) => <option value={item.id} key={item.id}>{locale === "zh-CN" ? item.nameZh : item.nameEn}</option>)}</select></label><div className="form-grid two-column"><label className="field"><span>{t("growth.touchType")}</span><select name="touchType">{["FIRST","ASSIST","LAST"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="field"><span>{t("growth.channel")}</span><input name="channel" required/></label></div><label className="field"><span>{t("growth.source")}</span><input name="source" required/></label><label className="field"><span>{t("growth.medium")}</span><input name="medium"/></label><label className="field"><span>{t("growth.content")}</span><textarea name="content" rows={3}/></label></>}
function JourneyFields({t}:{t:Translate}){return <><label className="field"><span>{t("growth.stage")}</span><select name="stage">{["INQUIRY","ASSESSMENT","PLANNING","APPLICATION","OFFER","ENROLLED","CLOSED"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="field"><span>{t("growth.probability")}</span><input name="probability" type="number" min="0" max="100" defaultValue="10" required/></label><label className="field"><span>{t("growth.nextAction")}</span><textarea name="nextAction" rows={3}/></label><label className="field"><span>{t("modules.dueAt")}</span><input name="nextActionAt" type="datetime-local"/></label></>}
function formatMoney(locale:string,value:number,currency:string){return new Intl.NumberFormat(locale,{style:"currency",currency,maximumFractionDigits:0}).format(value);}
function formatCurrencyMap(locale:string,values:Record<string,number>){const entries=Object.entries(values);return entries.length?entries.map(([currency,value])=>formatMoney(locale,value,currency)).join(" · "):"—";}

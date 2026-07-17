"use client";

import { useCallback, useState } from "react";
import { BadgeDollarSign, CheckCircle2, FileClock, HandCoins, Plus, ReceiptText, RotateCcw, Scale, Send } from "lucide-react";
import type { FinanceOverview, QuoteRecord } from "@/lib/phase2-repository";
import { useI18n } from "./i18n-provider";
import { InlineMessage, Pagination, SearchableSelect, SearchField, StatusBadge, Toast } from "./ui";
import { apiFetch, ApiClientError } from "@/lib/api-client";

type ActionKind = "submit" | "convert" | "schedule" | "payment" | "refund" | "completeRefund";
type RelatedOption = { value: string; label: string; detail: string };

export function FinancePage({ initial }: { initial: FinanceOverview }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pending, setPending] = useState(false);
  const [quotePage, setQuotePage] = useState(1);
  const [quoteQuery, setQuoteQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [organization, setOrganization] = useState("");
  const [quoteProduct, setQuoteProduct] = useState("");
  const [quoteBundle, setQuoteBundle] = useState("");
  const [quoteCurrency, setQuoteCurrency] = useState("CNY");
  const [options, setOptions] = useState<RelatedOption[]>([]);
  const [action, setAction] = useState<{ kind: ActionKind; id: string } | null>(null);
  const money = (amount: number, currency: string) => `${currency} ${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`.trim();

  const reload = async (nextPage = quotePage, query = quoteQuery) => {
    try {
      setData(await apiFetch<FinanceOverview>(`/api/finance?page=${nextPage}&q=${encodeURIComponent(query)}`));
    } catch {
      setError(t("finance.loadFailed"));
    }
  };
  const search = useCallback(async (query: string) => {
    try {
      const result = await apiFetch<{ items: Array<{ value: string; labelZh: string; labelEn: string; type: string }> }>(`/api/search/related?q=${encodeURIComponent(query)}`);
      setOptions(result.items.filter((item) => item.type === "ORGANIZATION").map((item) => ({ value: item.value.split(":")[1] ?? item.value, label: locale === "en" ? item.labelEn : item.labelZh, detail: t("finance.organization") })));
    } catch {
      setError(t("finance.searchFailed"));
    }
  }, [locale, t]);
  const execute = async (body: Record<string, unknown>) => {
    setPending(true); setError("");
    try {
      await apiFetch("/api/finance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await reload(); setToast(t("finance.saved")); setAction(null); return true;
    } catch (error) {
      const code = error instanceof ApiClientError ? error.code : "operation";
      setError(t(`finance.error.${code.toLowerCase()}`));
      return false;
    } finally {
      setPending(false);
    }
  };
  const createQuote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (!organization) { setError(t("finance.organizationRequired")); return; }
    if (!quoteProduct && !quoteBundle) { setError(t("finance.productOrBundleRequired")); return; }
    const ok = await execute({ operation: "createQuote", quote_no: form.get("number"), target_organization: organization, target_opportunity: null, target_product: quoteProduct || null, target_bundle: quoteBundle || null, target_exchange_rate: form.get("exchangeRate") || null, quote_currency: quoteCurrency, quote_subtotal: Number(form.get("subtotal")), quote_discount: Number(form.get("discount")), valid_through: form.get("validUntil"), terms_zh: form.get("termsZh"), terms_en: form.get("termsEn") });
    if (ok) { setCreateOpen(false); setQuoteProduct(""); setQuoteBundle(""); setQuoteCurrency("CNY"); event.currentTarget.reset(); }
  };
  const submitAction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!action) return; const form = new FormData(event.currentTarget);
    if (action.kind === "submit") await execute({ operation: "submitQuote", target_quote: action.id, business_reason: form.get("reason") });
    if (action.kind === "convert") await execute({ operation: "convertQuote", target_quote: action.id, contract_no: form.get("contractNo"), period_start: form.get("start"), period_end: form.get("end") });
    if (action.kind === "schedule") { const installments = String(form.get("installments") ?? "").split(";").map((value) => value.trim()).filter(Boolean).map((value) => { const [dueDate, amount] = value.split(":"); return { dueDate, amount: Number(amount) }; }); await execute({ operation: "saveReceivables", target_contract: action.id, installments }); }
    if (action.kind === "payment") { const schedule = data.receivables.find((item) => item.id === action.id); if (schedule) await execute({ operation: "recordPayment", target_contract: schedule.contractId, target_schedule: schedule.id, payment_amount: Number(form.get("amount")), payment_currency: schedule.currency, payment_reference: form.get("reference"), paid_on: new Date(String(form.get("paidOn"))).toISOString() }); }
    if (action.kind === "refund") await execute({ operation: "requestRefund", target_payment: action.id, refund_amount: Number(form.get("amount")), refund_reason: form.get("reason") });
    if (action.kind === "completeRefund") await execute({ operation: "completeRefund", target_refund: action.id, receipt: form.get("receipt") });
  };

  return <div className="page-stack finance-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t("finance.eyebrow")}</p><h1>{t("finance.title")}</h1><p>{t("finance.description")}</p></div><button className="primary-button" type="button" onClick={() => setCreateOpen((value) => !value)}><Plus size={17} />{t("finance.newQuote")}</button></section>
    <section className="quick-summary"><span><b>{data.quoteTotal}</b><small>{t("finance.quotes")}</small></span><span><b>{data.receivables.filter((item) => item.status !== "PAID").length}</b><small>{t("finance.openReceivables")}</small></span><span><b>{data.refunds.filter((item) => item.status === "PENDING_APPROVAL").length}</b><small>{t("finance.pendingRefunds")}</small></span><span><b>{data.reconciliations.filter((item) => !["MATCHED", "RESOLVED"].includes(item.status)).length}</b><small>{t("finance.reconciliationExceptions")}</small></span></section>
    {createOpen && <form className="surface finance-create" onSubmit={createQuote}><SectionTitle eyebrow="finance.quoteEyebrow" title="finance.createQuote" icon={BadgeDollarSign} t={t} /><SearchableSelect label={t("finance.organization")} value={organization} onChange={setOrganization} onSearch={search} options={options} placeholder={t("finance.searchOrganization")} /><div className="form-grid three-column"><Field label={t("finance.quoteNumber")} name="number"/><Field label={t("finance.validUntil")} name="validUntil" type="date"/><label className="field"><span>{t("finance.currency")}</span><input name="currency" value={quoteCurrency} pattern="[A-Za-z]{3}" onChange={(event)=>setQuoteCurrency(event.target.value.toUpperCase())} required/></label></div><div className="form-grid two-column"><label className="field"><span>{t("finance.product")}</span><select value={quoteProduct} onChange={(event)=>{setQuoteProduct(event.target.value);if(event.target.value)setQuoteBundle("");}}><option value="">{t("finance.noProduct")}</option>{data.products.map(item=><option value={item.id} key={item.id}>{locale==="zh-CN"?item.nameZh:item.nameEn} · {item.code}</option>)}</select></label><label className="field"><span>{t("finance.bundle")}</span><select value={quoteBundle} onChange={(event)=>{setQuoteBundle(event.target.value);if(event.target.value)setQuoteProduct("");}}><option value="">{t("finance.noBundle")}</option>{data.bundles.map(item=><option value={item.id} key={item.id}>{locale==="zh-CN"?item.nameZh:item.nameEn} · v{item.version}</option>)}</select></label></div><label className="field"><span>{t("finance.exchangeRate")}</span><select name="exchangeRate" defaultValue=""><option value="">{t("finance.baseCurrencyRate")}</option>{data.exchangeRates.filter(item=>item.quote===quoteCurrency).map(item=><option value={item.id} key={item.id}>{item.base}/{item.quote} · {item.rate} · {item.source}</option>)}</select></label><InlineMessage type="info">{t("finance.productOrBundleHelp")}</InlineMessage><div className="form-grid two-column"><Field label={t("finance.subtotal")} name="subtotal" type="number"/><Field label={t("finance.discount")} name="discount" type="number" defaultValue="0"/></div><div className="form-grid two-column"><TextArea label={t("finance.termsZh")} name="termsZh"/><TextArea label={t("finance.termsEn")} name="termsEn"/></div>{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" onClick={()=>setCreateOpen(false)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{pending?t("common.saving"):t("common.create")}</button></div></form>}
    <section className="surface finance-section"><SectionTitle eyebrow="finance.quoteEyebrow" title="finance.quotes" icon={FileClock} t={t}/><div className="table-toolbar"><SearchField value={quoteQuery} onChange={(value)=>{setQuoteQuery(value);setQuotePage(1);}} placeholder={t("finance.searchQuotes")}/><button className="secondary-button" type="button" onClick={()=>void reload(1,quoteQuery)}>{t("common.search")}</button></div><div className="finance-list">{data.quotes.map((quote)=><QuoteCard quote={quote} money={money} t={t} key={quote.id} onAction={(kind)=>kind==="accept"?void execute({operation:"acceptQuote",target_quote:quote.id}):setAction({kind,id:quote.id})}/>)}</div>{!data.quotes.length&&<div className="empty-state"><span>{t("finance.noQuotes")}</span></div>}<Pagination page={quotePage} totalPages={Math.max(1,Math.ceil(data.quoteTotal/10))} total={data.quoteTotal} pageSize={10} onPage={(next)=>{setQuotePage(next);void reload(next,quoteQuery);}}/></section>
    <section className="surface finance-section"><SectionTitle eyebrow="finance.receivableEyebrow" title="finance.contractSchedules" icon={HandCoins} t={t}/><div className="finance-list compact">{data.contracts.map((item)=><article className="finance-row" key={item.id}><div><b>{item.number}</b><small>{money(item.value,item.currency)}</small></div><StatusBadge tone={item.hasSchedule?"green":"amber"}>{t(item.hasSchedule?"finance.scheduleReady":"finance.scheduleMissing")}</StatusBadge>{!item.hasSchedule&&<button className="text-button" onClick={()=>setAction({kind:"schedule",id:item.id})}>{t("finance.schedule")}</button>}</article>)}</div></section>
    <section className="finance-grid"><div className="surface finance-section"><SectionTitle eyebrow="finance.receivableEyebrow" title="finance.receivables" icon={HandCoins} t={t}/>{data.receivables.map((item)=><article className="finance-row" key={item.id}><div><b>{item.contractNumber} · #{item.installment}</b><small>{t("finance.due",{date:item.dueDate})}</small></div><div><b>{money(item.paidAmount,item.currency)} / {money(item.amount,item.currency)}</b><StatusBadge tone={item.status==="PAID"?"green":item.status==="OVERDUE"?"red":"amber"}>{t(`finance.status.${item.status.toLowerCase()}`)}</StatusBadge></div>{item.status!=="PAID"&&<button className="text-button" onClick={()=>setAction({kind:"payment",id:item.id})}>{t("finance.recordPayment")}</button>}</article>)}</div>
      <div className="surface finance-section"><SectionTitle eyebrow="finance.refundEyebrow" title="finance.paymentsRefunds" icon={RotateCcw} t={t}/>{data.payments.map((item)=><article className="finance-row" key={item.id}><div><b>{item.reference||item.id.slice(0,8)}</b><small>{money(item.amount-item.refundedAmount,item.currency)} {t("finance.net")}</small></div><StatusBadge tone={item.refundedAmount?"amber":"green"}>{t(`finance.status.${item.status.toLowerCase()}`)}</StatusBadge>{item.refundedAmount<item.amount&&<button className="text-button" onClick={()=>setAction({kind:"refund",id:item.id})}>{t("finance.requestRefund")}</button>}</article>)}{data.refunds.map((item)=><article className="finance-row refund" key={item.id}><div><b>{item.number}</b><small>{item.reason}</small></div><StatusBadge tone={item.status==="PAID"?"green":item.status==="REJECTED"?"red":"amber"}>{t(`finance.status.${item.status.toLowerCase()}`)}</StatusBadge>{item.status==="APPROVED"&&<button className="text-button" onClick={()=>setAction({kind:"completeRefund",id:item.id})}>{t("finance.completeRefund")}</button>}</article>)}</div></section>
    <section className="surface finance-section"><SectionTitle eyebrow="finance.reconcileEyebrow" title="finance.reconciliation" icon={Scale} t={t}/>{data.reconciliations.map((item)=><article className="finance-row" key={item.id}><div><b>{item.contractId.slice(0,8)}</b><small>{item.reason||t("finance.noDifferenceReason")}</small></div><div><b>{money(item.difference,"")}</b><StatusBadge tone={item.status==="MATCHED"?"green":"amber"}>{t(`finance.status.${item.status.toLowerCase()}`)}</StatusBadge></div></article>)}</section>
    {action&&<ActionForm action={action} pending={pending} error={error} t={t} onClose={()=>setAction(null)} onSubmit={submitAction}/>} {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}
  </div>;
}

function QuoteCard({quote,money,t,onAction}:{quote:QuoteRecord;money:(value:number,currency:string)=>string;t:(key:string,values?:Record<string,string|number>)=>string;onAction:(kind:"submit"|"accept"|"convert")=>void}){return <article className="quote-card"><div><span className="record-avatar"><ReceiptText size={17}/></span><div><b>{quote.number}</b><small>{quote.organizationZh} / {quote.organizationEn}</small>{quote.bundleVersion&&<small>{t("finance.bundleVersion",{version:quote.bundleVersion})}</small>}</div></div><div><b>{money(quote.total,quote.currency)}</b><small>{t("finance.versionDiscount",{version:quote.version,discount:money(quote.discount,quote.currency)})}</small>{quote.baseCurrency&&quote.baseTotal!==null&&<small>{t("finance.baseAmount",{amount:money(quote.baseTotal,quote.baseCurrency)})}</small>}</div><div><StatusBadge tone={["APPROVED","ACCEPTED"].includes(quote.status)?"green":quote.status==="REJECTED"?"red":"amber"}>{t(`finance.status.${quote.status.toLowerCase()}`)}</StatusBadge><small>{t("finance.validUntilValue",{date:quote.validUntil})}</small></div><div className="quote-actions">{quote.status==="DRAFT"&&<button onClick={()=>onAction("submit")}><Send size={15}/>{t("finance.submit")}</button>}{quote.status==="APPROVED"&&<button onClick={()=>onAction("accept")}><CheckCircle2 size={15}/>{t("finance.accept")}</button>}{quote.status==="ACCEPTED"&&<button onClick={()=>onAction("convert")}><FileClock size={15}/>{t("finance.convert")}</button>}</div></article>}
function ActionForm({action,pending,error,t,onClose,onSubmit}:{action:{kind:ActionKind;id:string};pending:boolean;error:string;t:(key:string)=>string;onClose:()=>void;onSubmit:(event:React.FormEvent<HTMLFormElement>)=>void}){return <form className="surface inline-action-panel" onSubmit={onSubmit}><div><b>{t(`finance.action.${action.kind}`)}</b><button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>×</button></div>{action.kind==="submit"&&<TextArea label={t("finance.reason")} name="reason"/>}{action.kind==="convert"&&<div className="form-grid three-column"><Field label={t("finance.contractNumber")} name="contractNo"/><Field label={t("finance.start")} name="start" type="date"/><Field label={t("finance.end")} name="end" type="date"/></div>}{action.kind==="schedule"&&<TextArea label={t("finance.installments")} name="installments" placeholder="2026-08-01:50000; 2026-10-01:50000"/>}{action.kind==="payment"&&<div className="form-grid three-column"><Field label={t("finance.amount")} name="amount" type="number"/><Field label={t("finance.reference")} name="reference"/><Field label={t("finance.paidOn")} name="paidOn" type="datetime-local"/></div>}{action.kind==="refund"&&<div className="form-grid two-column"><Field label={t("finance.amount")} name="amount" type="number"/><Field label={t("finance.reason")} name="reason"/></div>}{action.kind==="completeRefund"&&<Field label={t("finance.receipt")} name="receipt"/>}{error&&<InlineMessage type="error">{error}</InlineMessage>}<button className="primary-button" disabled={pending}><CheckCircle2 size={16}/>{pending?t("common.saving"):t("common.confirm")}</button></form>}
function SectionTitle({eyebrow,title,icon:Icon,t}:{eyebrow:string;title:string;icon:React.ElementType;t:(key:string)=>string}){return <div className="surface-heading"><div><p className="eyebrow">{t(eyebrow)}</p><h2>{t(title)}</h2></div><Icon size={21}/></div>}
function Field({label,name,type="text",defaultValue}:{label:string;name:string;type?:string;defaultValue?:string}){return <label className="field"><span>{label}</span><input name={name} type={type} defaultValue={defaultValue} min={type==="number"?"0.01":undefined} step={type==="number"?"0.01":undefined} required/></label>}
function TextArea({label,name,placeholder}:{label:string;name:string;placeholder?:string}){return <label className="field"><span>{label}</span><textarea name={name} rows={3} placeholder={placeholder} required/></label>}

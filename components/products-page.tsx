"use client";

import { useMemo, useState } from "react";
import { Box, CircleDollarSign, PackageCheck, Plus, Users, X } from "lucide-react";
import { InlineMessage, Pagination, SearchField, StatusBadge, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import type { ProductRecord } from "@/lib/product-repository";

type Product = Omit<ProductRecord,"isDefault"|"currency"> & {isDefault?:boolean;currency?:string};

const defaultProducts: Product[] = [
  { id: "summer-camp", nameZh: "夏令营", nameEn: "Summer Camp", code: "CAMP-SUMMER", price: 28_000, billing: "products.billing.term", duration: "2–4 周", durationEn: "2–4 weeks", customers: 36, revenue: 1_008_000, active: true },
  { id: "admissions", nameZh: "升学", nameEn: "Admissions Planning", code: "ADMISSION", price: 120_000, billing: "products.billing.year", duration: "12–24 个月", durationEn: "12–24 months", customers: 68, revenue: 8_160_000, active: true },
  { id: "competition", nameZh: "竞赛", nameEn: "Competition Program", code: "COMPETE", price: 45_000, billing: "products.billing.project", duration: "8–16 周", durationEn: "8–16 weeks", customers: 42, revenue: 1_890_000, active: true },
  { id: "summer-school", nameZh: "夏校", nameEn: "Summer School Application", code: "SUMMER-SCHOOL", price: 32_000, billing: "products.billing.season", duration: "6–12 周", durationEn: "6–12 weeks", customers: 31, revenue: 992_000, active: true },
  { id: "foundation", nameZh: "预科", nameEn: "Foundation Program", code: "FOUNDATION", price: 180_000, billing: "products.billing.schoolYear", duration: "9–12 个月", durationEn: "9–12 months", customers: 18, revenue: 3_240_000, active: true },
];

const money = (value: number) => value >= 1_000_000 ? `¥ ${(value / 1_000_000).toFixed(2)}M` : `¥ ${(value / 1_000).toFixed(0)}K`;

export function ProductsPage({initialProducts=defaultProducts,persistent=false}:{initialProducts?:Product[];persistent?:boolean}) {
  const { locale, t } = useI18n();
  const [products, setProducts] = useState(initialProducts);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const pageSize = 5;
  const filtered = useMemo(() => products.filter((product) => `${product.nameZh} ${product.nameEn} ${product.code}`.toLowerCase().includes(query.toLowerCase())), [products, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const revenue = products.reduce((sum, product) => sum + product.revenue, 0);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const product: Product = {
      id: `custom-${Date.now()}`,
      nameZh: String(form.get("nameZh")),
      nameEn: String(form.get("nameEn")),
      code: String(form.get("code")).toUpperCase(),
      price: Number(form.get("price")),
      billing: `products.billing.${String(form.get("billing"))}`,
      duration: String(form.get("duration")),
      durationEn: String(form.get("duration")),
      customers: 0,
      revenue: 0,
      active: true,
    };
    if(persistent){const response=await fetch("/api/products",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"create",nameZh:product.nameZh,nameEn:product.nameEn,code:product.code,price:product.price,billing:String(form.get("billing")).replace("schoolYear","SCHOOL_YEAR").toUpperCase(),duration:product.duration,durationEn:product.duration})});const result=await response.json() as {item?:{id?:string};code?:string};if(!response.ok||!result.item?.id){setToast(t("products.saveFailed"));return;}product.id=result.item.id;}
    setProducts((current) => [...current, product]);
    setPage(Math.ceil((products.length + 1) / pageSize));
    setDrawerOpen(false);
    setToast(t("products.created", { name: locale === "zh-CN" ? product.nameZh : product.nameEn }));
  };
  const toggleProduct=async(product:Product,productName:string)=>{const active=!product.active;if(persistent){const response=await fetch("/api/products",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"toggle",id:product.id,active})});if(!response.ok){setToast(t("products.saveFailed"));return;}}setProducts((current)=>current.map((item)=>item.id===product.id?{...item,active}:item));setToast(t("products.toggled",{name:productName,status:t(active?"common.enabled":"common.inactive")}));};

  return <div className="page-stack products-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t("products.eyebrow")}</p><h1>{t("products.title")}</h1><p>{t("products.description")}</p></div><button className="primary-button" type="button" onClick={() => setDrawerOpen(true)}><Plus size={17} />{t("products.custom")}</button></section>
    {!persistent&&<InlineMessage type="warning">{t("products.sessionWarning")}</InlineMessage>}
    <section className="product-kpis"><ProductKpi icon={PackageCheck} tone="green" value={String(products.filter((item) => item.active).length)} label={t("products.activeCount")} /><ProductKpi icon={CircleDollarSign} tone="blue" value={money(revenue)} label={t("products.revenue")} /><ProductKpi icon={Users} tone="purple" value={String(products.reduce((sum, item) => sum + item.customers, 0))} label={t("products.customers")} /><ProductKpi icon={Box} tone="amber" value="5" label={t("products.defaultCount")} /></section>
    <section className="surface product-catalog-card">
      <div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("products.search")} /><StatusBadge tone="green">{t("products.supportCustom")}</StatusBadge></div>
      <div className="product-list-head"><span>{t("products.product")}</span><span>{t("products.price")}</span><span>{t("products.delivery")}</span><span>{t("products.customerCount")}</span><span>{t("products.spend")}</span><span>{t("common.status")}</span></div>
      {visible.map((product) => { const productName = locale === "zh-CN" ? product.nameZh : product.nameEn; return <article className="product-list-row" key={product.id}><div><span className="product-icon"><PackageCheck size={19} /></span><span><b>{productName}</b><small>{product.code}</small></span></div><span><b>{money(product.price)}</b><small>{product.billing.startsWith("products.") ? t(product.billing) : product.billing}</small></span><span><b>{locale === "en" && product.durationEn ? product.durationEn : product.duration}</b><small>{t("products.standardDelivery")}</small></span><span><b>{product.customers}</b><small>{t("products.purchaseCount")}</small></span><span><b>{money(product.revenue)}</b><small>{t("products.confirmedTotal")}</small></span><button type="button" onClick={() => toggleProduct(product,productName)}><StatusBadge tone={product.active ? "green" : "gray"}>{t(product.active ? "products.onSale" : "common.inactive")}</StatusBadge></button></article>; })}
      <Pagination page={safePage} totalPages={totalPages} total={filtered.length} pageSize={pageSize} onPage={setPage} />
    </section>
    {drawerOpen && <><button className="drawer-overlay" type="button" aria-label={t("products.closeForm")} onClick={() => setDrawerOpen(false)} /><aside className="record-drawer" role="dialog" aria-modal="true" aria-label={t("products.custom")}><div className="drawer-heading"><div><p className="eyebrow">{t("products.eyebrow")}</p><h2>{t("products.custom")}</h2><p>{t("products.codeHelp")}</p></div><button className="icon-button" type="button" aria-label={t("common.close")} onClick={() => setDrawerOpen(false)}><X size={20} /></button></div><form onSubmit={submit}><div className="form-grid two-column"><label className="field"><span>{t("products.nameZh")}</span><input name="nameZh" required /></label><label className="field"><span>{t("products.nameEn")}</span><input name="nameEn" required /></label></div><label className="field"><span>{t("products.code")}</span><input name="code" pattern="[A-Za-z0-9-]+" placeholder="EXAMPLE-PRODUCT" required /></label><div className="form-grid two-column"><label className="field"><span>{t("products.price")}</span><input name="price" type="number" min="0" step="100" required /></label><label className="field"><span>{t("products.billing")}</span><select name="billing" defaultValue="project"><option value="project">{t("products.billing.project")}</option><option value="term">{t("products.billing.term")}</option><option value="month">{t("products.billing.month")}</option><option value="year">{t("products.billing.year")}</option><option value="schoolYear">{t("products.billing.schoolYear")}</option></select></label></div><label className="field"><span>{t("products.duration")}</span><input name="duration" placeholder={t("products.durationPlaceholder")} required /></label><div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => setDrawerOpen(false)}>{t("common.cancel")}</button><button className="primary-button" type="submit"><Plus size={17} />{t("products.create")}</button></div></form></aside></>}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

function ProductKpi({ icon: Icon, tone, value, label }: { icon: React.ElementType; tone: string; value: string; label: string }) {
  return <article className="surface product-kpi"><span className={tone}><Icon size={21} /></span><div><b>{value}</b><small>{label}</small></div></article>;
}

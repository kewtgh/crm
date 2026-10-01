"use client";

import { useState } from "react";
import { CircleDollarSign, Pencil, Trash2 } from "lucide-react";
import type { ProductRecord } from "@/lib/product-repository";
import { DetailTabs } from "./detail-tabs";
import { ActionDisclosure } from "./action-disclosure";
import { MarkdownContent } from "./markdown-content";
import { StatusBadge } from "./ui";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";

export function ProductDetailPanel({product, canManage, canDelete, pending, onEdit, onPrice, onDelete}: {
  product: ProductRecord; canManage: boolean; canDelete: boolean; pending: boolean;
  onEdit: () => void; onPrice: () => void; onDelete: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const { t, locale } = useI18n(); const { formatDate } = useUserPreferences();
  const money = (value: number, currency: string) => new Intl.NumberFormat(locale, {style:"currency",currency,maximumFractionDigits:2}).format(value);
  const duration = (locale === "en" ? product.durationEn : product.duration) || product.duration || product.durationEn;
  const description = (locale === "en" ? product.descriptionEnMarkdown : product.descriptionZhMarkdown) || product.descriptionZhMarkdown || product.descriptionEnMarkdown;
  return <div className="product-detail-panel">
    <div className="detail-metrics"><span><b>{product.code}</b><small>{t("products.code")}</small></span><span><b>{t(product.billing)}</b><small>{t("products.billing")}</small></span><span><b>{duration||"—"}</b><small>{t("products.delivery")}</small></span><span><StatusBadge tone={product.lifecycleStatus==="ACTIVE"?"green":product.lifecycleStatus==="DRAFT"?"blue":"amber"}>{t(`products.lifecycle.${product.lifecycleStatus.toLowerCase()}`)}</StatusBadge><small>{t("common.status")}</small></span></div>
    <DetailTabs label={t("products.product")} active={tab} onChange={setTab} items={[{key:"overview",label:"productDetail.overview"},{key:"prices",label:"productDetail.prices"},{key:"purchasers",label:"productDetail.purchasers"}]}>
      {tab === "overview" && <section className="detail-section"><h3>{t("products.introduction")}</h3><MarkdownContent value={description} empty={t("products.introductionEmpty")}/></section>}
      {tab === "prices" && <section className="detail-section"><h3>{t("productDetail.prices")}</h3><p className="detail-list-caption">{t("productDetail.priceHelp")}</p><div className="detail-record-list">{product.prices.map(price=><article key={price.currency}><div><b>{price.currency}</b><small>{t("productDetail.effective")}: {price.effectiveFrom?formatDate(price.effectiveFrom,{dateOnly:true}):"—"}</small></div><strong>{money(price.amount,price.currency)}</strong></article>)}</div>{!product.prices.length&&<p className="detail-empty">{t("productDetail.noPrices")}</p>}</section>}
      {tab === "purchasers" && <section className="detail-section"><h3>{t("products.purchasers")} <small>{product.purchasers.length}</small></h3><div className="detail-record-list">{product.purchasers.map(buyer=><article key={buyer.contractId}><div><b>{(locale==="en"?buyer.nameEn:buyer.nameZh)||buyer.nameZh||buyer.nameEn}</b><small>{buyer.contractNumber} · {t(`contracts.status.${buyer.contractStatus.toLowerCase()==="pending_approval"?"pending":buyer.contractStatus.toLowerCase()}`)}</small></div><div><strong>{money(buyer.confirmedSpend,buyer.currency)}</strong><small>{t("contracts.relationshipLevel",{level:buyer.relationshipLevel})}</small></div></article>)}</div>{!product.purchasers.length&&<p className="detail-empty">{t("products.noPurchasers")}</p>}</section>}
    </DetailTabs>
    {(canManage||canDelete)&&<footer className="detail-actions">{canManage&&<><button className="secondary-button" type="button" disabled={pending} onClick={onPrice}><CircleDollarSign size={16}/>{t("products.managePrice")}</button><button className="primary-button" type="button" disabled={pending} onClick={onEdit}><Pencil size={16}/>{t("common.edit")}</button></>}{canDelete&&<ActionDisclosure><button className="danger-menu-action" type="button" disabled={pending} onClick={onDelete}><Trash2 size={16}/>{t("common.delete")}</button></ActionDisclosure>}</footer>}
  </div>;
}

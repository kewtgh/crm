"use client";
import {useState} from "react";
import {ProductsPage} from "./products-page";
import {AccessibleDrawer,InlineMessage} from "./ui";
import {useI18n} from "./i18n-provider";
import {useCapability} from "./app-user-context";
import {apiFetch} from "@/lib/api-client";
import type {ProductBundle,ExchangeRateSnapshot} from "@/lib/operations-repository";
import type {ProductRecord} from "@/lib/product-repository";
export function ProductCatalogAction({productId}:{productId?:string}){
 const {t}=useI18n(),canManage=useCapability("catalog.manage"),[items,setItems]=useState<ProductRecord[]|null>(null),[catalog,setCatalog]=useState<{bundles:ProductBundle[];exchangeRates:ExchangeRateSnapshot[]}>({bundles:[],exchangeRates:[]}),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const open=async()=>{setBusy(true);setError(false);try{const [result,details]=await Promise.all([apiFetch<{items:ProductRecord[]}>("/api/products"),apiFetch<{bundles:ProductBundle[];exchangeRates:ExchangeRateSnapshot[]}>("/api/catalog")]);setCatalog(details);setItems(result.items);}catch{setError(true);}finally{setBusy(false);}};
 if(!canManage)return null;
 return <><button className="secondary-button" type="button" disabled={busy} onClick={()=>void open()}>{t(productId?"common.edit":"products.title")}</button>{error&&<InlineMessage type="error">{t("products.loadFailed")}</InlineMessage>}{items&&<AccessibleDrawer title={t("products.title")} onClose={()=>setItems(null)}><ProductsPage initialProducts={items} initialBundles={catalog.bundles} initialExchangeRates={catalog.exchangeRates} initialFocus={productId}/></AccessibleDrawer>}</>;
}

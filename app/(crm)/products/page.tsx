import { ProductsPage } from "@/components/products-page";
import { DataLoadError } from "@/components/data-state";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { listProducts } from "@/lib/product-repository";
import { listExchangeRates, listProductBundles } from "@/lib/operations-repository";
import {z} from "zod";
import {FocusedRecordNotice} from "@/components/focused-record-notice";

export const generateMetadata = () => localizedPageMetadata("meta.products");

export default async function Page({searchParams}:{searchParams:Promise<{focus?:string}>}) {
  const params=await searchParams,parsed=z.uuid().safeParse(params.focus),focus=parsed.success?parsed.data:undefined;
  const [productsResult, bundlesResult, ratesResult] = await Promise.allSettled([
    listProducts(),
    listProductBundles(),
    listExchangeRates(),
  ]);
  if (productsResult.status !== "fulfilled") return <DataLoadError detailKey="products.loadFailed"/>;
  return <div className="page-stack">{params.focus&&<FocusedRecordNotice found={Boolean(focus&&productsResult.value.some(item=>item.id===focus))} href="/products"/>}<ProductsPage key={focus??"directory"}
    initialFocus={focus}
    initialProducts={productsResult.value}
    initialBundles={bundlesResult.status === "fulfilled" ? bundlesResult.value : []}
    initialExchangeRates={ratesResult.status === "fulfilled" ? ratesResult.value : []}
    initialCatalogError={bundlesResult.status !== "fulfilled" || ratesResult.status !== "fulfilled"}
  /></div>;
}

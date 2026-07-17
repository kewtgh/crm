import { ProductsPage } from "@/components/products-page";
import { DataLoadError } from "@/components/data-state";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { listProducts } from "@/lib/product-repository";
import { listExchangeRates, listProductBundles } from "@/lib/operations-repository";

export const generateMetadata = () => localizedPageMetadata("meta.products");

export default async function Page() {
  const [productsResult, bundlesResult, ratesResult] = await Promise.allSettled([
    listProducts(),
    listProductBundles(),
    listExchangeRates(),
  ]);
  if (productsResult.status !== "fulfilled") return <DataLoadError detailKey="products.loadFailed"/>;
  return <ProductsPage
    initialProducts={productsResult.value}
    initialBundles={bundlesResult.status === "fulfilled" ? bundlesResult.value : []}
    initialExchangeRates={ratesResult.status === "fulfilled" ? ratesResult.value : []}
    initialCatalogError={bundlesResult.status !== "fulfilled" || ratesResult.status !== "fulfilled"}
  />;
}

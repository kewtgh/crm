import { ProductsPage } from "@/components/products-page";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.products");

export default function Page() {
  return <ProductsPage />;
}

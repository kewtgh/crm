import type { Metadata } from "next";
import { ProductsPage } from "@/components/products-page";

export const metadata: Metadata = { title: "销售产品与服务" };

export default function Page() {
  return <ProductsPage />;
}

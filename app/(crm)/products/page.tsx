import { ProductsPage } from "@/components/products-page";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { listProducts } from "@/lib/product-repository";

export const generateMetadata = () => localizedPageMetadata("meta.products");

export default async function Page() { let products; try{products=await listProducts();}catch{products=undefined;} return products?<ProductsPage initialProducts={products} persistent/>:<ProductsPage/>; }

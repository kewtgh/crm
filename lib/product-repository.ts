import { supabaseJson } from "./supabase-server";

export type ProductPrice={currency:string;amount:number;effectiveFrom:string};
export type ProductCurrencyMetric={revenue:number;customers:number};
export type ProductRecord={id:string;nameZh:string;nameEn:string;code:string;price:number;prices:ProductPrice[];metrics:Record<string,ProductCurrencyMetric>;billing:string;duration:string;durationEn:string;customers:number;revenue:number;active:boolean;isDefault:boolean;currency:string};

export async function listProducts():Promise<ProductRecord[]>{
  const products=await supabaseJson<Array<Record<string,unknown>>>("/rest/v1/rpc/product_catalog_snapshot",{method:"POST",body:"{}"});
  return products.map((item)=>{
    const prices=(item.prices as ProductPrice[]|undefined)??[];
    const metrics=(item.metrics as Record<string,ProductCurrencyMetric>|undefined)??{};
    const primary=prices[0]??{currency:"CNY",amount:0,effectiveFrom:""};
    const primaryMetric=metrics[primary.currency]??{revenue:0,customers:0};
    return {
      id:String(item.id),nameZh:String(item.nameZh),nameEn:String(item.nameEn),code:String(item.code),
      price:Number(primary.amount),prices,metrics,
      billing:`products.billing.${String(item.billing).toLowerCase().replace("school_year","schoolYear")}`,
      duration:String(item.durationZh),durationEn:String(item.durationEn),
      customers:Number(primaryMetric.customers),revenue:Number(primaryMetric.revenue),
      active:Boolean(item.active),isDefault:Boolean(item.isDefault),currency:primary.currency,
    };
  });
}

export async function createProduct(input:{nameZh:string;nameEn:string;code:string;price:number;currency:string;billing:string;duration:string;durationEn:string}){return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/create_product_with_price",{method:"POST",body:JSON.stringify({product_code:input.code,product_name_zh:input.nameZh,product_name_en:input.nameEn,product_billing:input.billing,product_duration_zh:input.duration,product_duration_en:input.durationEn,price_currency:input.currency,price_amount:input.price})});}
export async function setProductActive(id:string,active:boolean,requestKey:string){return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/idempotent_set_product_active",{method:"POST",body:JSON.stringify({target_product:id,target_active:active,p_request_key:requestKey})});}
export async function setProductPrice(input:{id:string;currency:string;amount:number;effectiveOn:string}){return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/set_product_price",{method:"POST",body:JSON.stringify({target_product:input.id,price_currency:input.currency,price_amount:input.amount,effective_on:input.effectiveOn})});}

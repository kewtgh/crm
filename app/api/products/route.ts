import { NextResponse } from "next/server";
import { z } from "zod";
import { createProduct,listProducts,setProductActive,setProductPrice } from "@/lib/product-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";
import { apiRoute, requireApiAal2, requireApiRole, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
const createSchema=z.object({operation:z.literal("create"),nameZh:z.string().trim().min(1).max(100),nameEn:z.string().trim().min(1).max(120),code:z.string().regex(/^[A-Za-z0-9-]{2,40}$/),price:z.number().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/),billing:z.enum(["PROJECT","TERM","MONTH","YEAR","SCHOOL_YEAR","SEASON"]),duration:z.string().trim().min(1).max(80),durationEn:z.string().trim().min(1).max(80)});
const toggleSchema=z.object({operation:z.literal("toggle"),id:z.string().uuid(),active:z.boolean(),requestKey:z.string().trim().min(8).max(160)});const priceSchema=z.object({operation:z.literal("price"),id:z.string().uuid(),currency:z.string().regex(/^[A-Z]{3}$/),amount:z.number().nonnegative(),effectiveOn:z.string().date()});const schema=z.discriminatedUnion("operation",[createSchema,toggleSchema,priceSchema]);
const fail=(error:unknown)=>error instanceof SupabaseRequestError?NextResponse.json({code:error.code,message:error.message},{status:error.status}):NextResponse.json({code:"PRODUCT_OPERATION_FAILED"},{status:500});
async function get(){await requireApiUser();try{return NextResponse.json({items:await listProducts()});}catch(error){return fail(error);}}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});await requireApiRole("SUPER_ADMIN","ADMIN","SALES_DIRECTOR");await requireApiAal2();try{const item=parsed.data.operation==="create"?await createProduct(parsed.data):parsed.data.operation==="price"?await setProductPrice(parsed.data):await setProductActive(parsed.data.id,parsed.data.active,parsed.data.requestKey);return NextResponse.json({item});}catch(error){return fail(error);}}
export const GET=apiRoute(get,"PRODUCT_LOAD_FAILED");
export const POST=apiRoute(post,"PRODUCT_OPERATION_FAILED");

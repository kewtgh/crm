import { NextResponse } from "next/server";
import { z } from "zod";
import { createProduct,listProducts,setProductLifecycle,setProductPrice,updateProduct } from "@/lib/product-repository";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { apiRoute, requireApiCapability, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
const narratives={descriptionZhMarkdown:z.string().max(20000).default(""),descriptionEnMarkdown:z.string().max(20000).default("")};
const lifecycleStatus=z.enum(["DRAFT","ACTIVE","PAUSED"]);
const createSchema=z.object({operation:z.literal("create"),nameZh:z.string().trim().min(1).max(100),nameEn:z.string().trim().min(1).max(120),code:z.string().regex(/^[A-Za-z0-9-]{2,40}$/),...narratives,lifecycleStatus:lifecycleStatus.default("DRAFT"),price:z.number().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/),billing:z.enum(["PROJECT","TERM","MONTH","YEAR","SCHOOL_YEAR","SEASON"]),duration:z.string().trim().min(1).max(80),durationEn:z.string().trim().min(1).max(80)});
const updateSchema=z.object({operation:z.literal("update"),id:z.uuid(),expectedUpdatedAt:z.iso.datetime(),nameZh:z.string().trim().min(1).max(100),nameEn:z.string().trim().min(1).max(120),code:z.string().regex(/^[A-Za-z0-9-]{2,40}$/),...narratives,lifecycleStatus,billing:z.enum(["PROJECT","TERM","MONTH","YEAR","SCHOOL_YEAR","SEASON"]),duration:z.string().trim().min(1).max(80),durationEn:z.string().trim().min(1).max(80),isDefault:z.boolean()});
const lifecycleSchema=z.object({operation:z.literal("lifecycle"),id:z.string().uuid(),lifecycleStatus,requestKey:z.string().trim().min(8).max(160)});const priceSchema=z.object({operation:z.literal("price"),id:z.string().uuid(),currency:z.string().regex(/^[A-Z]{3}$/),amount:z.number().nonnegative(),effectiveOn:z.string().date()});const schema=z.discriminatedUnion("operation",[createSchema,updateSchema,lifecycleSchema,priceSchema]);
const fail=(error:unknown)=>error instanceof DatabaseRequestError?NextResponse.json({code:error.code,message:error.message},{status:error.status}):NextResponse.json({code:"PRODUCT_OPERATION_FAILED"},{status:500});
async function get(){await requireApiUser();try{return NextResponse.json({items:await listProducts()});}catch(error){return fail(error);}}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});await requireApiCapability("catalog.manage");try{const item=parsed.data.operation==="create"?await createProduct(parsed.data):parsed.data.operation==="update"?await updateProduct(parsed.data):parsed.data.operation==="price"?await setProductPrice(parsed.data):await setProductLifecycle(parsed.data.id,parsed.data.lifecycleStatus,parsed.data.requestKey);return NextResponse.json({item});}catch(error){return fail(error);}}
export const GET=apiRoute(get,"PRODUCT_LOAD_FAILED");
export const POST=apiRoute(post,"PRODUCT_OPERATION_FAILED");

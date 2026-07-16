import { NextResponse } from "next/server";
import { z } from "zod";
import { createProduct,listProducts,setProductActive } from "@/lib/product-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";
const createSchema=z.object({operation:z.literal("create"),nameZh:z.string().trim().min(1).max(100),nameEn:z.string().trim().min(1).max(120),code:z.string().regex(/^[A-Za-z0-9-]{2,40}$/),price:z.number().nonnegative(),billing:z.enum(["PROJECT","TERM","MONTH","YEAR","SCHOOL_YEAR","SEASON"]),duration:z.string().trim().min(1).max(80),durationEn:z.string().trim().min(1).max(80)});
const toggleSchema=z.object({operation:z.literal("toggle"),id:z.string().uuid(),active:z.boolean()});const schema=z.discriminatedUnion("operation",[createSchema,toggleSchema]);
const fail=(error:unknown)=>error instanceof SupabaseRequestError?NextResponse.json({code:error.code,message:error.message},{status:error.status}):NextResponse.json({code:"PRODUCT_OPERATION_FAILED"},{status:500});
export async function GET(){try{return NextResponse.json({items:await listProducts()});}catch(error){return fail(error);}}
export async function POST(request:Request){const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});try{const item=parsed.data.operation==="create"?await createProduct(parsed.data):await setProductActive(parsed.data.id,parsed.data.active);return NextResponse.json({item});}catch(error){return fail(error);}}

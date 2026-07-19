import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { deleteSharedView, listSharedViews, saveSharedView, viewConfigSchema } from "@/lib/saved-views";

const resource=z.enum(["schools","people","tasks","opportunities","contracts","finance","data-quality"]);
const mutation=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("save"),resource,name:z.string().trim().min(1).max(60),visibility:z.enum(["PERSONAL","TEAM"]),config:viewConfigSchema}),
  z.object({operation:z.literal("delete"),id:z.string().uuid()}),
]);

async function get(request:Request){
  const user=await requireApiUser();
  const parsed=resource.safeParse(new URL(request.url).searchParams.get("resource"));
  if(!parsed.success)return NextResponse.json({code:"INVALID_VIEW_RESOURCE"},{status:400});
  return NextResponse.json({items:await listSharedViews(parsed.data,user.id)});
}
async function post(request:Request){
  if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
  await requireApiUser();
  const parsed=mutation.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return NextResponse.json({code:"INVALID_VIEW_INPUT"},{status:400});
  if(parsed.data.operation==="delete"){await deleteSharedView(parsed.data.id);return NextResponse.json({ok:true});}
  return NextResponse.json({item:await saveSharedView(parsed.data.resource,parsed.data.name,parsed.data.visibility,parsed.data.config)});
}
export const GET=apiRoute(get,"VIEW_LOAD_FAILED");
export const POST=apiRoute(post,"VIEW_SAVE_FAILED");

import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,ApiError,requireApiCapability,parseUuid} from "@/lib/api";
import {getDocumentWorkspace,previewContractDocument,requestContractDocument} from "@/lib/contract-document-repository";
import {DocumentError,docxMime} from "@/lib/contract-document-engine.mjs";
const kind=z.enum(["CUSTOMER_CONTRACT","CHANNEL_AGREEMENT_VERSION"]);
const schema=z.object({operation:z.enum(["validate","preview","generate"]),sourceKind:kind,sourceId:z.uuid(),expectedRevision:z.number().int().positive(),templateKey:z.enum(["student-program","channel-recruitment"]),templateVersion:z.number().int().positive(),
 context:z.object({enrollmentId:z.uuid().optional(),productId:z.uuid().optional(),cohortId:z.uuid().optional(),commissionRuleId:z.uuid().optional()}).strict(),confirmedValues:z.record(z.string(),z.union([z.string().max(5000),z.boolean()])),requestKey:z.string().min(8).max(160),regenerationReason:z.string().max(500).default("")}).strict();
async function get(request:Request){await requireApiCapability("contracts.view");const q=new URL(request.url).searchParams;const parsedKind=kind.safeParse(q.get("sourceKind"));if(!parsedKind.success)throw new ApiError("DOCUMENT_INPUT_INVALID",400);const sourceKind=parsedKind.data;return NextResponse.json(await getDocumentWorkspace(sourceKind,parseUuid(q.get("sourceId")??"")));}
async function post(request:Request){await requireApiCapability("contracts.manage");const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ApiError("DOCUMENT_INPUT_INVALID",400);
 try{
  if(parsed.data.operation==="generate")return NextResponse.json({id:await requestContractDocument(parsed.data)},{status:202});
  const result=await previewContractDocument(parsed.data);
  if(parsed.data.operation==="validate")return NextResponse.json({sourceRevision:result.context.sourceRevision,templateStatus:result.version.status,configurationReady:result.configurationReady,
    fields:result.version.fields.map(f=>({key:f.key,source:f.source,category:f.category,sensitive:f.sensitive,value:f.sensitive?"••••":(result.resolved.values as Record<string,string>)[f.key]})),issues:result.resolved.issues});
  return new NextResponse(Buffer.from(result.artifact),{headers:{"content-type":docxMime,"content-disposition":'attachment; filename="PREVIEW-ONLY.docx"',"cache-control":"private, no-store"}});
 }catch(error){if(error instanceof DocumentError)throw new ApiError(error.code,error.code.includes("CONFLICT")||error.code.includes("APPROVED")||error.code==="GENERATION_BLOCKED"?409:400,error.code,{fields:error.fields});throw error;}
}
export const GET=apiRoute(get,"DOCUMENTS_LOAD_FAILED");
export const POST=apiRoute(post,"DOCUMENT_OPERATION_FAILED");

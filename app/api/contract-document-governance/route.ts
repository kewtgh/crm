import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,ApiError,requireApiCapability,requireApiAal2} from "@/lib/api";
import {databaseJson} from "@/lib/db/gateway";
import {readDocumentCatalog,readRegisteredTemplate} from "@/lib/contract-document-files.mjs";
import {sealDocumentConfiguration,openDocumentConfiguration} from "@/lib/contract-document-configuration.mjs";
const schema=z.discriminatedUnion("operation",[
 z.object({operation:z.literal("registerCatalog")}).strict(),
 z.object({operation:z.literal("saveConfiguration"),values:z.record(z.string(),z.string().min(1).max(5000))}).strict(),
 z.object({operation:z.literal("templateStatus"),id:z.uuid(),status:z.enum(["APPROVED","RETIRED"])}).strict(),
 z.object({operation:z.literal("configurationStatus"),id:z.uuid(),status:z.enum(["APPROVED","RETIRED"])}).strict(),
]);
async function authorize(){await requireApiCapability("catalog.manage");await requireApiCapability("contracts.manage");await requireApiCapability("approvals.decide");await requireApiAal2();}
async function get(){await authorize();const [templates,configurations]=await Promise.all([
 databaseJson("/db/table/contract_document_template_versions?select=id,template_key,version_number,status,active,created_by,approved_by,approved_at&order=created_at.desc&limit=100"),
 databaseJson("/db/table/contract_document_configurations?select=id,version_number,status,active,created_by,approved_by,approved_at&order=created_at.desc&limit=100")]);
 return NextResponse.json({templates,configurations});}
async function post(request:Request){await authorize();const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ApiError("DOCUMENT_INPUT_INVALID",400);const input=parsed.data;
 const call=(name:string,data:Record<string,unknown>)=>databaseJson(`/db/rpc/${name}`,{method:"POST",body:JSON.stringify(data)});
 if(input.operation==="registerCatalog"){const c=await readDocumentCatalog();const ids=[];for(const version of c.versions){await readRegisteredTemplate(version);ids.push(await call("register_document_template",{definition:version}));}return NextResponse.json({ids});}
 if(input.operation==="saveConfiguration"){const catalog=await readDocumentCatalog();const allowed=new Set(catalog.versions.flatMap((v:{fields:Array<{key:string}>})=>v.fields.filter(f=>/^(company|bank)\./.test(f.key)).map(f=>f.key)));if(Object.keys(input.values).some(k=>!allowed.has(k)))throw new ApiError("DOCUMENT_CONFIGURATION_INVALID",400);return NextResponse.json({id:await call("save_document_configuration",{encrypted_values:sealDocumentConfiguration(input.values)})});}
 if(input.operation==="templateStatus"){
  const rows=await databaseJson<Array<{definition:Record<string,unknown>}>>(`/db/table/contract_document_template_versions?select=definition&id=eq.${input.id}&limit=1`);
  if(!rows[0])throw new ApiError("TEMPLATE_NOT_FOUND",404);await readRegisteredTemplate(rows[0].definition);
  return NextResponse.json({result:await call("govern_document_template",{record_id:input.id,next_status:input.status})});
 }
 if(input.status==="APPROVED"){
  const rows=await databaseJson<Array<{encrypted_values:Record<string,unknown>}>>(`/db/table/contract_document_configurations?select=encrypted_values&id=eq.${input.id}&limit=1`);
  if(!rows[0])throw new ApiError("CONFIGURATION_NOT_FOUND",404);openDocumentConfiguration(rows[0].encrypted_values);
 }
 return NextResponse.json({result:await call("govern_document_configuration",{record_id:input.id,next_status:input.status})});
}
export const GET=apiRoute(get,"DOCUMENT_GOVERNANCE_FAILED");
export const POST=apiRoute(post,"DOCUMENT_GOVERNANCE_FAILED");

import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import writeXlsxFile from "write-excel-file/node";

const required=["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
const missing=required.filter(key=>!process.env[key]);
if(missing.length)throw new Error(`Missing export-worker variables: ${missing.join(", ")}`);
const base=process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,"");
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers={apikey:key,authorization:`Bearer ${key}`,"content-type":"application/json"};
const heartbeat=createWorkerHeartbeat(base,key,"GENERATED_JOBS");
const workerId=process.env.WORKER_ID?.trim()||`generated-jobs:${process.pid}:${crypto.randomUUID()}`;
const exportFormats=new Set(["CSV","XLSX","PDF"]);
const artifactTypes={
  CSV:{extension:"csv",contentType:"text/csv; charset=utf-8"},
  XLSX:{extension:"xlsx",contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
  PDF:{extension:"pdf",contentType:"application/pdf"},
};

async function request(path,options={}){const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...options.headers}});const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(`${path} failed (${response.status}: ${body?.code??body?.message??"unknown"})`);return body;}
const csvCell=value=>{const text=String(value??"");const safe=typeof value==="string"&&/^[=+@-]/.test(text)?`'${text}`:text;return`"${safe.replaceAll('"','""')}"`;};
const csv=rows=>`\uFEFF${rows.map(row=>row.map(csvCell).join(",")).join("\r\n")}\r\n`;

let notoFontRanges;
async function loadNotoFontRanges(){
  if(notoFontRanges)return notoFontRanges;
  const css=await readFile(new URL("../node_modules/@fontsource/noto-sans-sc/400.css",import.meta.url),"utf8");
  const ranges=[];
  const block=/src:\s*url\(\.\/files\/([^)]+\.woff2)\)[\s\S]*?unicode-range:\s*([^;]+);/g;
  for(const match of css.matchAll(block)){
    const intervals=match[2].split(",").map(value=>value.trim()).flatMap(value=>{
      const parsed=/^U\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i.exec(value);
      return parsed?[[Number.parseInt(parsed[1],16),Number.parseInt(parsed[2]??parsed[1],16)]]:[];
    });
    ranges.push({file:match[1],intervals});
  }
  notoFontRanges=ranges;
  return ranges;
}
function splitCell(value,maxUnits){
  const text=String(value??"");
  if(!text)return[""];
  const lines=[];let current="";let units=0;
  for(const character of text){
    const width=character.codePointAt(0)>255?2:1;
    if(current&&units+width>maxUnits){lines.push(current);current="";units=0;}
    current+=character;units+=width;
  }
  if(current||!lines.length)lines.push(current);
  return lines;
}
async function pdf(rows){
  const document=await PDFDocument.create();
  document.registerFontkit(fontkit);
  const latin=await document.embedFont(StandardFonts.Helvetica);
  const fontCache=new Map();
  const ranges=await loadNotoFontRanges();
  const fontFor=async character=>{
    const point=character.codePointAt(0);
    if(point<=255)return latin;
    const source=ranges.find(item=>item.intervals.some(([from,to])=>point>=from&&point<=to));
    if(!source)return latin;
    if(!fontCache.has(source.file)){
      const bytes=await readFile(new URL(`../node_modules/@fontsource/noto-sans-sc/files/${source.file}`,import.meta.url));
      fontCache.set(source.file,await document.embedFont(bytes,{subset:true}));
    }
    return fontCache.get(source.file);
  };
  const drawText=async(page,text,x,y,size,color)=>{
    let cursor=x;let run="";let runFont;
    const flush=()=>{if(!run)return;page.drawText(run,{x:cursor,y,size,font:runFont,color});cursor+=runFont.widthOfTextAtSize(run,size);run="";};
    for(const rawCharacter of String(text??"")){
      const point=rawCharacter.codePointAt(0);
      const character=point>255&&!ranges.some(item=>item.intervals.some(([from,to])=>point>=from&&point<=to))?"?":rawCharacter;
      const characterFont=await fontFor(character);
      if(runFont&&runFont!==characterFont)flush();
      runFont=characterFont;run+=character;
    }
    flush();
  };
  const pageWidth=841.89,pageHeight=595.28,margin=24,fontSize=6.5,lineHeight=8.5;
  const columnCount=Math.max(1,rows[0]?.length??1);
  const columnWidth=(pageWidth-margin*2)/columnCount;
  const maxUnits=Math.max(5,Math.floor(columnWidth/fontSize*1.7));
  let page;let y;
  const addPage=()=>{
    page=document.addPage([pageWidth,pageHeight]);
    y=pageHeight-margin-lineHeight;
  };
  addPage();
  for(let rowIndex=0;rowIndex<rows.length;rowIndex+=1){
    const row=rows[rowIndex];
    const cells=Array.from({length:columnCount},(_,index)=>splitCell(row[index],maxUnits));
    const rowLines=Math.max(1,...cells.map(value=>value.length));
    const rowHeight=rowLines*lineHeight+4;
    if(y-rowHeight<margin){addPage();}
    if(rowIndex===0)page.drawRectangle({x:margin,y:y-rowHeight+2,width:pageWidth-margin*2,height:rowHeight,color:rgb(0.91,0.94,0.98)});
    for(let column=0;column<columnCount;column+=1){
      const x=margin+column*columnWidth+2;
      for(let line=0;line<cells[column].length;line+=1){
        await drawText(page,cells[column][line],x,y-line*lineHeight,fontSize,rgb(0.08,0.11,0.17));
      }
    }
    y-=rowHeight;
    page.drawLine({start:{x:margin,y:y+2},end:{x:pageWidth-margin,y:y+2},thickness:0.25,color:rgb(0.78,0.81,0.86)});
  }
  const bytes=await document.save();
  return Buffer.from(bytes);
}
async function artifact(rows,format){
  if(format==="XLSX"){
    const sheet=rows.map((row,rowIndex)=>row.map(value=>({
      value:String(value??""),
      type:String,
      wrap:true,
      fontWeight:rowIndex===0?"bold":undefined,
      backgroundColor:rowIndex===0?"E8EEF7":undefined,
    })));
    return writeXlsxFile(sheet,{orientation:"landscape",stickyRowsCount:1,columns:rows[0]?.map(()=>({width:24}))??[]}).toBuffer();
  }
  if(format==="PDF")return pdf(rows);
  return csv(rows);
}

async function contractExport(job){
  const id=String(job.parameters?.objectId??"");
  const rows=await request(`/rest/v1/contracts?select=contract_number,start_date,end_date,currency,contract_value,status,relationship_level,organizations(name_zh,name_en),products(name_zh,name_en)&id=eq.${encodeURIComponent(id)}&workspace_id=eq.${job.workspace_id}&limit=1`);
  if(!rows[0])throw new Error("Contract not found");const item=rows[0];
  return [["Contract number","Organization (ZH)","Organization (EN)","Product (ZH)","Product (EN)","Start date","End date","Currency","Value","Status","Relationship level"],[item.contract_number,item.organizations?.name_zh,item.organizations?.name_en,item.products?.name_zh,item.products?.name_en,item.start_date,item.end_date,item.currency,item.contract_value,item.status,item.relationship_level]];
}
function periodRange(objectId){const match=/^(\d{4}-\d{2}-\d{2})_(month|quarter|year)_/.exec(objectId);if(!match)throw new Error("Invalid performance period");const start=new Date(`${match[1]}T00:00:00Z`);const end=new Date(start);if(match[2]==="month")end.setUTCMonth(end.getUTCMonth()+1);if(match[2]==="quarter")end.setUTCMonth(end.getUTCMonth()+3);if(match[2]==="year")end.setUTCFullYear(end.getUTCFullYear()+1);return{start:match[1],end:end.toISOString().slice(0,10)};}
async function performanceExport(job){
  const range=periodRange(String(job.parameters?.objectId??""));const ws=job.workspace_id;if(!ws)throw new Error("Export job workspace is missing");
  const [members,targets,payments]=await Promise.all([
    request(`/rest/v1/sales_team_members?select=id,name_zh,name_en,role,team&workspace_id=eq.${ws}&active=eq.true&order=name_en`),
    request(`/rest/v1/performance_targets?select=id,target_amount,currency&workspace_id=eq.${ws}&period_start=lte.${range.end}&period_end=gte.${range.start}`),
    request(`/rest/v1/payments?select=id,amount,currency,paid_at&workspace_id=eq.${ws}&status=eq.CONFIRMED&paid_at=gte.${range.start}T00:00:00Z&paid_at=lt.${range.end}T00:00:00Z`),
  ]);
  const targetIds=targets.map(item=>item.id);const paymentIds=payments.map(item=>item.id);
  const [allocations,contributions]=await Promise.all([
    targetIds.length?request(`/rest/v1/performance_allocations?select=contributor_member_id,allocated_amount&target_id=in.(${targetIds.join(",")})`):[],
    paymentIds.length?request(`/rest/v1/performance_contributions?select=contributor_member_id,amount,payment_id&payment_id=in.(${paymentIds.join(",")})`):[],
  ]);
  const targetBy=new Map();for(const item of allocations)targetBy.set(item.contributor_member_id,(targetBy.get(item.contributor_member_id)??0)+Number(item.allocated_amount));
  const actualBy=new Map();for(const item of contributions)actualBy.set(item.contributor_member_id,(actualBy.get(item.contributor_member_id)??0)+Number(item.amount));
  return [["Staff ID","Name (ZH)","Name (EN)","Role","Team","Period start","Period end","Allocated target","Confirmed performance"],...members.map(item=>[item.id,item.name_zh,item.name_en,item.role,item.team,range.start,range.end,targetBy.get(item.id)??0,actualBy.get(item.id)??0])];
}
async function marketingContactsExport(job){
  const channel=String(job.parameters?.channel??"").toUpperCase();if(!["EMAIL","SMS","PHONE","WECHAT","WHATSAPP"].includes(channel))throw new Error("Invalid marketing channel");
  const rows=await request(`/rest/v1/rpc/marketing_export_rows`,{method:"POST",body:JSON.stringify({target_workspace:job.workspace_id,export_channel:channel})});
  return [["Contact ID","Name (ZH)","Name (EN)","Email","Phone","Authorized channel","Consent source","Obtained at","Retention until"],...rows.map(item=>[item.contact_id,item.name_zh,item.name_en,item.email,item.phone,item.channel,item.consent_source,item.obtained_at,item.retention_until])];
}
async function requestAll(path){
  const rows=[];
  for(let start=0;start<10_000;start+=500){
    const page=await request(path,{headers:{Range:`${start}-${start+499}`}});
    rows.push(...page);
    if(page.length<500)break;
  }
  return rows;
}
async function crmExport(job){
  const resource=String(job.parameters?.resource??"");
  const definitions={
    schools:{
      table:"organizations",
      select:"id,name_zh,name_en,city,curriculum,status,owner_id,key_contact_coverage,completeness,last_contact_at,updated_at",
      search:["name_zh","name_en","city","curriculum"],
      sort:{primary:"name_zh",secondary:"city",status:"status",meta:"key_contact_coverage",extra:"last_contact_at",completeness:"completeness"},
      header:["ID","Name (ZH)","Name (EN)","City","Curriculum","Status","Owner ID","Key contact coverage","Completeness","Last contact","Updated at"],
      row:item=>[item.id,item.name_zh,item.name_en,item.city,item.curriculum,item.status,item.owner_id,item.key_contact_coverage,item.completeness,item.last_contact_at,item.updated_at],
    },
    people:{
      table:"contacts",
      select:"id,name_zh,name_en,title,email,phone,status,owner_id,completeness,last_interaction_at,updated_at",
      search:["name_zh","name_en","title","email","phone"],
      sort:{primary:"name_zh",secondary:"title",status:"status",meta:"email",extra:"last_interaction_at",completeness:"completeness"},
      header:["ID","Name (ZH)","Name (EN)","Title","Email","Phone","Status","Owner ID","Completeness","Last interaction","Updated at"],
      row:item=>[item.id,item.name_zh,item.name_en,item.title,item.email,item.phone,item.status,item.owner_id,item.completeness,item.last_interaction_at,item.updated_at],
    },
    tasks:{
      table:"crm_tasks",
      select:"id,title_zh,title_en,related_type,related_label,status,priority,owner_id,due_at,sla_due_at,completed_at,updated_at",
      search:["title_zh","title_en","related_label"],
      sort:{primary:"title_zh",secondary:"related_label",status:"status",meta:"owner_id",extra:"due_at",completeness:"updated_at"},
      header:["ID","Title (ZH)","Title (EN)","Related type","Related record","Status","Priority","Owner ID","Due at","SLA due at","Completed at","Updated at"],
      row:item=>[item.id,item.title_zh,item.title_en,item.related_type,item.related_label,item.status,item.priority,item.owner_id,item.due_at,item.sla_due_at,item.completed_at,item.updated_at],
    },
    students:{
      table:"students",
      select:"id,student_number,current_grade,academic_year,status,owner_id,created_at,updated_at,contacts(name_zh,name_en),households(name_zh,name_en)",
      search:[],
      sort:{primary:"updated_at",secondary:"current_grade",status:"status",meta:"academic_year",extra:"created_at",completeness:"updated_at"},
      header:["ID","Student number","Name (ZH)","Name (EN)","Household (ZH)","Household (EN)","Grade","Academic year","Status","Owner ID","Created at","Updated at"],
      row:item=>[item.id,item.student_number,item.contacts?.name_zh,item.contacts?.name_en,item.households?.name_zh,item.households?.name_en,item.current_grade,item.academic_year,item.status,item.owner_id,item.created_at,item.updated_at],
    },
    households:{
      table:"households",
      select:"id,name_zh,name_en,status,address,owner_id,created_at,updated_at",
      search:["name_zh","name_en","address"],
      sort:{primary:"name_zh",secondary:"name_en",status:"status",meta:"address",extra:"created_at",completeness:"updated_at"},
      header:["ID","Name (ZH)","Name (EN)","Status","Address","Owner ID","Created at","Updated at"],
      row:item=>[item.id,item.name_zh,item.name_en,item.status,item.address,item.owner_id,item.created_at,item.updated_at],
    },
    leads:{
      table:"leads",
      select:"id,subject_type,name_zh,name_en,source,status,qualification_score,qualification_note,pipeline_key,owner_id,converted_at,created_at,updated_at",
      search:["name_zh","name_en","source"],
      activeFilter:false,
      sort:{primary:"updated_at",secondary:"name_en",status:"status",meta:"qualification_score",extra:"created_at",completeness:"updated_at"},
      header:["ID","Subject type","Name (ZH)","Name (EN)","Source","Status","Qualification score","Evidence","Pipeline","Owner ID","Converted at","Created at","Updated at"],
      row:item=>[item.id,item.subject_type,item.name_zh,item.name_en,item.source,item.status,item.qualification_score,item.qualification_note,item.pipeline_key,item.owner_id,item.converted_at,item.created_at,item.updated_at],
    },
    sales:{
      table:"opportunities",
      select:"id,title_zh,title_en,stage,probability,amount,currency,owner_id,expected_close_date,created_at,updated_at",
      search:["title_zh","title_en"],
      activeFilter:false,
      sort:{primary:"updated_at",secondary:"title_en",status:"stage",meta:"amount",extra:"expected_close_date",completeness:"probability"},
      statusField:"stage",
      header:["ID","Title (ZH)","Title (EN)","Stage","Probability","Amount","Currency","Owner ID","Expected close","Created at","Updated at"],
      row:item=>[item.id,item.title_zh,item.title_en,item.stage,item.probability,item.amount,item.currency,item.owner_id,item.expected_close_date,item.created_at,item.updated_at],
    },
    finance:{
      table:"contracts",
      select:"id,contract_number,start_date,end_date,currency,contract_value,status,relationship_level,owner_id,created_at,updated_at,organizations(name_zh,name_en),payments(amount,currency,status,paid_at,refunded_amount)",
      search:["contract_number"],
      activeFilter:false,
      sort:{primary:"updated_at",secondary:"contract_number",status:"status",meta:"contract_value",extra:"end_date",completeness:"relationship_level"},
      header:["Contract ID","Contract number","Organization (ZH)","Organization (EN)","Start","End","Contract currency","Contract value","Status","Relationship level","Owner ID","Payment currency totals","Refunded currency totals","Created at","Updated at"],
      row:item=>{
        const totals=new Map(),refunds=new Map();
        for(const payment of item.payments??[]){if(payment.status==="CONFIRMED"){totals.set(payment.currency,(totals.get(payment.currency)??0)+Number(payment.amount));refunds.set(payment.currency,(refunds.get(payment.currency)??0)+Number(payment.refunded_amount??0));}}
        const display=map=>[...map].map(([currency,value])=>`${currency} ${value}`).join("; ");
        return[item.id,item.contract_number,item.organizations?.name_zh,item.organizations?.name_en,item.start_date,item.end_date,item.currency,item.contract_value,item.status,item.relationship_level,item.owner_id,display(totals),display(refunds),item.created_at,item.updated_at];
      },
    },
  };
  const definition=definitions[resource];
  if(!definition)throw new Error("Invalid CRM export resource");
  const query=String(job.parameters?.query??"").replace(/[*,()]/g," ").trim().slice(0,100);
  const status=String(job.parameters?.status??"all");
  const sort=String(job.parameters?.sort??"primary");
  const direction=job.parameters?.direction==="desc"?"desc":"asc";
  const params=new URLSearchParams({select:definition.select,workspace_id:`eq.${job.workspace_id}`});
  if(definition.activeFilter!==false)params.set("archived_at","is.null");
  if(query&&definition.search.length)params.set("or",`(${definition.search.map(field=>`${field}.ilike.*${query}*`).join(",")})`);
  if(status!=="all")params.set(definition.statusField??"status",`eq.${status}`);
  if(job.parameters?.scope==="OWNER"){
    const requester=String(job.parameters?.requesterId??job.created_by);
    params.set("owner_id",`eq.${requester}`);
  }
  params.set("order",`${definition.sort[sort]??definition.sort.primary}.${direction}`);
  const rows=await requestAll(`/rest/v1/${definition.table}?${params}`);
  return [definition.header,...rows.map(definition.row)];
}
async function setJob(id,status,extra={}){return request(`/rest/v1/generated_jobs?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status,updated_at:new Date().toISOString(),...extra})});}
async function expireArtifacts(){const expired=await request(`/rest/v1/generated_jobs?select=id,artifact_path&status=eq.READY&expires_at=lt.${encodeURIComponent(new Date().toISOString())}&limit=50`);for(const job of expired){if(job.artifact_path)await fetch(`${base}/storage/v1/object/crm-exports/${job.artifact_path}`,{method:"DELETE",headers}).catch(()=>undefined);await setJob(job.id,"EXPIRED");}}

try{
  await expireArtifacts();
  const jobs=await request("/rest/v1/rpc/claim_generated_jobs_leased",{
    method:"POST",
    body:JSON.stringify({batch_size:Number(process.env.EXPORT_BATCH_SIZE??10),worker_id:workerId,lease_seconds:900}),
  });
  let ready=0;
  for(const job of jobs){
    try{const rows=job.job_type==="CONTRACT_EXPORT"?await contractExport(job):job.job_type==="MARKETING_CONTACT_EXPORT"?await marketingContactsExport(job):job.job_type==="CRM_EXPORT"?await crmExport(job):await performanceExport(job);const requested=String(job.parameters?.format??"CSV").toUpperCase();const format=exportFormats.has(requested)?requested:"CSV";const content=await artifact(rows,format);const type=artifactTypes[format];const path=`${job.workspace_id}/${job.id}.${type.extension}`;const upload=await fetch(`${base}/storage/v1/object/crm-exports/${path}`,{method:"POST",headers:{apikey:key,authorization:`Bearer ${key}`,"content-type":type.contentType,"x-upsert":"false"},body:content,signal:AbortSignal.timeout(30_000)});if(!upload.ok)throw new Error(`Storage upload failed (${upload.status})`);const expiresAt=new Date(Date.now()+86400000).toISOString();await request("/rest/v1/rpc/complete_generated_job_leased",{method:"POST",body:JSON.stringify({job_id:job.id,token:job.lease_token,object_path:path,artifact_expires_at:expiresAt})});await request("/rest/v1/user_notifications",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:job.workspace_id,user_id:job.created_by,kind:"EXPORT",title_key:"notification.export.title",body_key:"notification.export.body",values:{type:job.job_type,format},source_type:"EXPORT",source_id:job.id})});ready+=1;}catch(error){await request("/rest/v1/rpc/fail_generated_job_leased",{method:"POST",body:JSON.stringify({job_id:job.id,token:job.lease_token,failure:String(error instanceof Error?error.message:"Unknown export error").slice(0,500)})});}
  }
  await heartbeat.success({claimed:jobs.length,ready});
  process.stdout.write(`Processed ${jobs.length} export jobs; ${ready} ready.\n`);
}catch(error){
  await heartbeat.failure(error).catch(()=>undefined);
  throw error;
}

import {unzipDocx,docxMime,money,DocumentError} from './contract-document-engine.mjs';
export const extractorVersion='LABELS_V1';
export const uploadLimits={bytes:8_000_000,pages:100,chars:300_000,chunks:5000};
const fail=code=>{throw new DocumentError(code);};
export function safeUploadName(name){return String(name).normalize('NFKC').replace(/[\\/\x00-\x1f\x7f]/g,'_').replace(/\.\./g,'_').slice(-160)||'document';}
export function uploadFormat(bytes,name,mime){
 if(!bytes.length||bytes.length>uploadLimits.bytes)fail('UPLOAD_SIZE_INVALID');
 const ext=String(name).split('.').at(-1)?.toLowerCase();
 if(ext==='docx'&&mime===docxMime&&Buffer.from(bytes).subarray(0,4).equals(Buffer.from([80,75,3,4])))return 'DOCX';
 if(ext==='pdf'&&mime==='application/pdf'&&Buffer.from(bytes).subarray(0,5).toString()==='%PDF-')return 'PDF';
 fail('UPLOAD_FORMAT_UNSUPPORTED');
}
const decode=s=>s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,(_,k)=>{if(k[0]!=='#')return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[k];const n=k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):Number(k.slice(1));if(n>0x10ffff||n<0||n>=0xd800&&n<=0xdfff)fail('DOCX_XML_INVALID');return String.fromCodePoint(n);});
export const normalizeText=s=>String(s).normalize('NFKC').replace(/[\t\r ]+/g,' ').trim();
export function docxChunks(bytes){
 const entries=unzipDocx(bytes),chunks=[];let chars=0;
 if(entries.length>1000)fail('DOCX_EXPANSION_LIMIT');
 if(entries.some(e=>/vbaProject|vbaData/i.test(e.name)))fail('DOCX_MACRO_UNSUPPORTED');
 for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(!/\.(xml|rels)$/.test(e.name))continue;
  let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(e.data);}catch{fail('DOCX_XML_INVALID');}
  if(/macroEnabled/i.test(xml))fail('DOCX_MACRO_UNSUPPORTED');
  if(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,'')))fail('DOCX_XML_INVALID');
  if(/<!DOCTYPE|<!ENTITY|vbaProject|TargetMode\s*=\s*["']External["']/i.test(xml))fail('DOCX_EXTERNAL_CONTENT_UNSUPPORTED');
  const stack=[];for(const tag of xml.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]+>/g)){const raw=tag[0];if(/^<(!|\?)/.test(raw))continue;const name=/^<\/?([\w:.-]+)/.exec(raw)?.[1];if(!name)fail('DOCX_XML_INVALID');if(raw.startsWith('</')){if(stack.pop()!==name)fail('DOCX_XML_INVALID');}else if(!raw.endsWith('/>'))stack.push(name);}
  if(stack.length)fail('DOCX_XML_INVALID');
  if(!/^word\/(document|header\d+|footer\d+)\.xml$/.test(e.name))continue;
  let paragraph=0,table=-1,row=-1,cell=-1,inside=false;
  for(const token of xml.matchAll(/<w:tbl\b[^>]*>|<\/w:tbl>|<w:tr\b[^>]*>|<w:tc\b[^>]*>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)){
   const tag=token[0];if(tag.startsWith('<w:tbl')){table++;row=-1;inside=true;continue;}if(tag==='</w:tbl>'){inside=false;continue;}if(tag.startsWith('<w:tr')){row++;cell=-1;continue;}if(tag.startsWith('<w:tc')){cell++;continue;}
   const text=[...tag.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(br|tab)\b[^>]*\/?\s*>/g)].map(m=>m[2]?m[2]==='br'?'\n':'\t':decode(m[1])).join('');
   const location={part:e.name,paragraph:paragraph++,...inside?{table,row,cell}:{}};
   if(!text.trim())continue;chars+=text.length;if(chars>uploadLimits.chars||chunks.length>=uploadLimits.chunks)fail('EXTRACTION_LIMIT');
   chunks.push({index:chunks.length,location,text,normalizedText:normalizeText(text)});
  }
 }
 if(!chunks.length)fail('DOCUMENT_TEXT_MISSING');return chunks;
}
export async function pdfChunks(bytes){
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useWorkerFetch:false,disableFontFace:true,useSystemFonts:false,maxImageSize:1,stopAtErrors:true});
 let doc;try{
  doc=await task.promise;if(doc.numPages>uploadLimits.pages)fail('PDF_PAGE_LIMIT');const chunks=[];let chars=0;
  for(let page=1;page<=doc.numPages;page++){
   const p=await doc.getPage(page),content=await p.getTextContent();let text='',block=0,y;
   const flush=()=>{if(text.trim()){chars+=text.length;if(chars>uploadLimits.chars||chunks.length>=uploadLimits.chunks)fail('EXTRACTION_LIMIT');chunks.push({index:chunks.length,location:{page,block:block++},text,normalizedText:normalizeText(text)});}text='';};
   for(const item of content.items){if(!('str' in item))continue;if(y!==undefined&&Math.abs(item.transform[5]-y)>2)flush();y=item.transform[5];text+=item.str+(item.hasEOL?'\n':' ');if(item.hasEOL)flush();}flush();p.cleanup();
  }
  if(chunks.map(c=>c.text).join('').replace(/\s/g,'').length<8)fail('OCR_REQUIRED_NOT_SUPPORTED');return chunks;
 }catch(error){if(error.name==='PasswordException')fail('PDF_PASSWORD_UNSUPPORTED');if(error instanceof DocumentError)throw error;fail('PDF_INVALID');}finally{await task.destroy();}
}
const aliases={
 'contract.reference':['合同编号','Contract reference'], 'contract.amount':['合同金额','合同总额','Contract amount'], 'contract.currency':['币种','Contract currency'],
 'participant.name':['参与学生','学生姓名','Participant'], 'buyer.signing_name':['购买主体','购买人','Buyer'],
 'guardian.required':['是否需要监护人','Guardian required'], 'guardian.name':['监护人姓名','Guardian name'], 'guardian.capacity':['监护人身份','Guardian capacity'],
 'contract.signing_date':['签署日期','Signing date'], 'program.name':['项目名称','Program'], 'cohort.name':['批次','Cohort'],
 'program.start_on':['项目开始日期','Program start'], 'program.end_on':['项目结束日期','Program end'], 'program.itinerary':['项目行程','Itinerary'], 'payment.terms':['付款条款','Payment terms'],
 'agreement.reference':['代理协议编号','协议编号','Agreement reference'], 'channel.legal_name':['渠道法律名称','Channel legal name'], 'channel.signatory':['渠道签署人','Channel signatory'],
 'commission.amount':['佣金金额','固定佣金','Commission amount'], 'commission.currency':['佣金币种','Commission currency'],
};
export function confirmationTarget(f,kind){
 if(f.category==='UNSUPPORTED')return 'UNSUPPORTED';
 if(f.category!=='USER_CONFIRMED'||/^company\./.test(f.key)||kind==='CUSTOMER_CONTRACT'&&/^bank\./.test(f.key))return 'CANONICAL_READ_ONLY';
 return 'DOCUMENT_ONLY';
}
export function normalizeCandidate(raw,f){
 const value=normalizeText(raw);
 if(f.type==='money'){const m=/^(?:(?:CNY|USD|RMB|人民币|美元|¥|￥|\$)\s*)?((?:\d{1,3}(?:,\d{3})+|\d{1,12})(?:\.\d{1,2})?)(?:\s*(?:元|美元|CNY|USD|RMB))?(?:\s*\/\s*(?:student|人|学生))?$/i.exec(value);if(!m)return {value,state:'AMBIGUOUS'};try{return {value:money(m[1].replaceAll(',','')),state:'VALID'};}catch{return {value,state:'INVALID'};}}
 if(f.type==='currency'){const k=value.toUpperCase();return {value:{RMB:'CNY','人民币':'CNY','美元':'USD','¥':'CNY','$':'USD'}[k]??k,state:/^(CNY|USD|RMB|人民币|美元|¥|\$)$/.test(k)?'VALID':'AMBIGUOUS'};}
 if(f.type==='date'){
  const m=/^(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})日?$/.exec(value);
  if(!m)return {value,state:'AMBIGUOUS'};const d=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;return {value:d,state:Number.isFinite(new Date(d).getTime())&&new Date(d).toISOString().slice(0,10)===d?'VALID':'INVALID'};
 }
 if(f.type==='boolean')return /^(true|yes|是|需要)$/i.test(value)?{value:true,state:'VALID'}:/^(false|no|否|不需要)$/i.test(value)?{value:false,state:'VALID'}:{value,state:'AMBIGUOUS'};
 return {value,state:value.length&&value.length<=5000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)?'VALID':'INVALID'};
}
const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function extractCandidates(chunks,fields,kind){
 const candidates=[];
 for(const f of fields){
  const names=[...new Set([f.key,f.label_zh,f.label_en,...aliases[f.key]??[]].filter(Boolean))];
  const re=new RegExp(`(?:^|[;；\\n])\\s*(${names.map(escaped).join('|')})\\s*[:：]\\s*([^;；\\n]+)`,'gi');
  const hits=[];
  for(const c of chunks)for(const match of c.text.matchAll(re)){
   const raw=match[2].trim(),normalized=normalizeCandidate(raw,f);hits.push({fieldKey:f.key,rawValue:raw,normalizedValue:normalized.value,sourceLocation:{...c.location,chunk:c.index,start:match.index,end:match.index+match[0].length},sourceExcerpt:match[0].trim().slice(0,5500),extractionMethod:'EXACT_LABEL_MATCH',confidenceState:normalized.state==='AMBIGUOUS'?'AMBIGUOUS':'EXACT',validationState:normalized.state});
  }
  for(const label of chunks){
   if(label.location.table===undefined||!names.some(name=>normalizeText(name).toLowerCase()===normalizeText(label.text.replace(/[:：]\s*$/,'')).toLowerCase()))continue;
   const values=chunks.filter(c=>c.location.part===label.location.part&&c.location.table===label.location.table&&c.location.row===label.location.row&&c.location.cell===label.location.cell+1);
   for(const c of values){const raw=c.text.trim(),normalized=normalizeCandidate(raw,f);hits.push({fieldKey:f.key,rawValue:raw,normalizedValue:normalized.value,sourceLocation:{...c.location,chunk:c.index,labelChunk:label.index,start:0,end:c.text.length},sourceExcerpt:`${label.text} | ${c.text}`.slice(0,5500),extractionMethod:'STRUCTURED_TABLE_MATCH',confidenceState:normalized.state==='AMBIGUOUS'?'AMBIGUOUS':'EXACT',validationState:normalized.state});}
  }
  const distinct=new Set(hits.map(h=>JSON.stringify(h.normalizedValue)));
  if(!hits.length)hits.push({fieldKey:f.key,rawValue:null,normalizedValue:null,sourceLocation:null,sourceExcerpt:null,extractionMethod:'EXACT_LABEL_MATCH',confidenceState:'UNSUPPORTED',validationState:'MISSING_IN_DOCUMENT'});
  for(const h of hits)candidates.push({...h,type:f.type,candidateKey:`${f.key}:${candidates.length}`,labelZh:f.label_zh,labelEn:f.label_en,confirmationTarget:confirmationTarget(f,kind),sensitive:!!f.sensitive||/^(participant|buyer|guardian|bank)\./.test(f.key),confidenceState:distinct.size>1?'AMBIGUOUS':h.confidenceState,reviewStatus:'PENDING'});
 }
 return candidates;
}
export function compareCandidate(candidate,current){
 if(candidate.confirmationTarget==='UNSUPPORTED')return 'UNSUPPORTED';
 if(candidate.validationState==='MISSING_IN_DOCUMENT')return 'MISSING_IN_DOCUMENT';
 if(candidate.confidenceState==='AMBIGUOUS'||candidate.validationState!=='VALID')return 'AMBIGUOUS';
 if(candidate.confirmationTarget==='DOCUMENT_ONLY')return 'DOCUMENT_ONLY';
 if(current===null||current===undefined)return 'MISSING_IN_CRM';
 let comparable=current;if(candidate.type==='money'){try{comparable=money(String(current).replace(/(\.\d{2})0+$/,"$1"));}catch{return 'CONFLICT';}}else if(candidate.type==='currency')comparable=normalizeCandidate(String(current),{type:'currency'}).value;
 return normalizeText(comparable)===normalizeText(candidate.normalizedValue)?'MATCH':'CONFLICT';
}

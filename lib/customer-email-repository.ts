import { createHash } from "node:crypto";
import { databaseJson } from "./db/gateway";
import { createCommunicationThread,queueCommunicationMessage } from "./v220-repository";
import { renderCustomerEmail,type CustomerEmailTemplate } from "./customer-email-templates";
export type EmailPreview={id:string;name:string;email:string;subject:string;body:string;purpose:string;blocked:boolean};
export async function previewCustomerEmail(ids:string[],template:CustomerEmailTemplate,locale:"zh-CN"|"en"){
  const contacts=await databaseJson<Array<{id:string;name_zh:string;name_en:string;email:string|null;owner_id:string|null;do_not_contact:boolean}>>(`/db/table/contacts?select=id,name_zh,name_en,email,owner_id,do_not_contact&id=in.(${ids.join(",")})&archived_at=is.null&limit=50`);
  const owners=[...new Set(contacts.map(contact=>contact.owner_id).filter(Boolean))];
  const profiles=owners.length?await databaseJson<Array<{user_id:string;display_name_zh:string;display_name_en:string}>>(`/db/table/user_profiles?select=user_id,display_name_zh,display_name_en&user_id=in.(${owners.join(",")})`):[];
  const items:EmailPreview[]=ids.map(id=>{
    const contact=contacts.find(item=>item.id===id),owner=profiles.find(item=>item.user_id===contact?.owner_id);
    const name=contact?(locale==="en"?contact.name_en||contact.name_zh:contact.name_zh||contact.name_en):"—";
    const ownerName=owner?(locale==="en"?owner.display_name_en||owner.display_name_zh:owner.display_name_zh||owner.display_name_en):(locale==="en"?"Customer service team":"客户服务团队");
    return{id,name,email:contact?.email??"",blocked:!contact||!!contact.do_not_contact||!contact.email,...renderCustomerEmail(template,locale,name,ownerName)};
  });
  const hash=createHash("sha256").update(JSON.stringify(items)).digest("hex");
  return{items,hash};
}
export async function queueCustomerEmail(items:EmailPreview[],requestKey:string,delivery={createThread:createCommunicationThread,queueMessage:queueCommunicationMessage}){
  const results:Array<{id:string;queued:boolean;code?:string;threadId?:string}>=[];
  // Four bounded concurrent recipients; each uses its own durable idempotency key.
  for(let offset=0;offset<items.length;offset+=4){
    const chunk=await Promise.all(items.slice(offset,offset+4).map(async item=>{
      if(item.blocked)return{id:item.id,queued:false,code:"RECIPIENT_UNAVAILABLE"};
      const key=`customer-email:${requestKey}:${item.id}`;
      try{
        const thread=await delivery.createThread({contactId:item.id,subject:item.subject,channel:"EMAIL",purpose:item.purpose,requestKey:key});
        await delivery.queueMessage(thread.id,item.body,key);
        return{id:item.id,queued:true,threadId:thread.id};
      }catch(error){const code=error&&typeof error==="object"&&"code" in error&&typeof error.code==="string"&&/^[A-Z][A-Z0-9_]{2,80}$/.test(error.code)?error.code:"COMMUNICATION_QUEUE_FAILED";return{id:item.id,queued:false,code};}
    }));results.push(...chunk);
  }
  return{results,queued:results.filter(item=>item.queued).length,failed:results.filter(item=>!item.queued).length};
}

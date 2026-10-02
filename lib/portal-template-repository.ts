import { databaseJson } from "./db/gateway";
import type { PortalTemplateContent,SavedPortalTemplate } from "./portal-invitation-templates";
import type { EmailTemplateVisibility } from "./customer-email-templates";
type TemplateRow={id:string;name:string;revision:number;visibility:EmailTemplateVisibility;content:PortalTemplateContent};
const template=(row:TemplateRow):SavedPortalTemplate=>({id:row.id,name:row.name,revision:row.revision,visibility:row.visibility,...row.content});
export async function listPortalTemplates(){
  const rows=await databaseJson<TemplateRow[]>("/db/table/customer_email_templates?category=eq.PORTAL&archived_at=is.null&order=name&limit=200");
  return rows.map(template);
}
export async function savePortalTemplate(input:{id:string;expectedRevision:number|null;name:string;visibility:EmailTemplateVisibility;content:PortalTemplateContent}){
  const row=await databaseJson<TemplateRow>("/db/rpc/save_customer_email_template",{method:"POST",body:JSON.stringify({target_template:input.id,expected_revision:input.expectedRevision,template_name:input.name,template_content:input.content,template_visibility:input.visibility,template_category:"PORTAL"})});
  return template(row);
}
export async function archivePortalTemplate(id:string,revision:number){
  await databaseJson("/db/rpc/save_customer_email_template",{method:"POST",body:JSON.stringify({target_template:id,expected_revision:revision,template_name:null,template_content:null,archive:true,template_category:"PORTAL"})});
}

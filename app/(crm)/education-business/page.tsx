import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { EducationBusinessWorkspace } from "@/components/education-business-workspace";
import { DataLoadError } from "@/components/data-state";
import { businessResources,type BusinessContext } from "@/lib/education-business";
export const generateMetadata=()=>localizedPageMetadata("business.title");
export default async function Page({searchParams}:{searchParams:Promise<{subject?:string;subjectId?:string;resource?:string}>}){
  await requireCapability("education.view");
  const params=await searchParams;
  const subject=z.enum(["ORGANIZATION","HOUSEHOLD","STUDENT"]).safeParse(params.subject),id=z.uuid().safeParse(params.subjectId);
  if((params.subject!==undefined||params.subjectId!==undefined)&&(!subject.success||!id.success))return <DataLoadError detailKey="business.contextInvalid"/>;
  const context:BusinessContext|undefined=subject.success&&id.success?{type:subject.data,id:id.data}:undefined;
  const resource=z.enum(businessResources).safeParse(params.resource);
  return <EducationBusinessWorkspace context={context} initialResource={resource.success?resource.data:undefined}/>;
}

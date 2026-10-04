import {z} from "zod";
import {requireCapability} from "@/lib/auth";
import {localizedPageMetadata} from "@/lib/page-metadata";
import {listSuccessCases,getSuccessCase} from "@/lib/student-success-repository";
import {getEnrollment} from "@/lib/enrollment-repository";
import {StudentSuccessWorkspace} from "@/components/student-success-workspace";
import {WorkspaceTabs,familyTabs} from "@/components/workspace-tabs";
export const generateMetadata=()=>localizedPageMetadata("success.title");
export default async function Page({searchParams}:{searchParams:Promise<{focus?:string;enrollmentId?:string;create?:string}>}){
 await requireCapability("education.view");const params=await searchParams,focus=z.uuid().safeParse(params.focus),enrollmentId=z.uuid().safeParse(params.enrollmentId);
 const [initial,detail,enrollment]=await Promise.all([listSuccessCases({enrollmentId:enrollmentId.success?enrollmentId.data:undefined}).catch(()=>null),focus.success?getSuccessCase(focus.data).catch(()=>null):null,enrollmentId.success?getEnrollment(enrollmentId.data).catch(()=>null):null]);
 return <div className="page-stack"><WorkspaceTabs items={familyTabs} active="/student-success"/><StudentSuccessWorkspace initial={initial} initialDetail={detail} enrollment={enrollment} create={params.create==="1"}/></div>;
}

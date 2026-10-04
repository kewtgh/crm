import {z} from "zod";
import {requireCapability} from "@/lib/auth";
import {localizedPageMetadata} from "@/lib/page-metadata";
import {getApplication,listApplications} from "@/lib/application-repository";
import {getEnrollment} from "@/lib/enrollment-repository";
import {ApplicationsWorkspace} from "@/components/applications-workspace";
import {WorkspaceTabs,familyTabs} from "@/components/workspace-tabs";
export const generateMetadata=()=>localizedPageMetadata("applications.title");
export default async function Page({searchParams}:{searchParams:Promise<{focus?:string;enrollmentId?:string;create?:string}>}){
 await requireCapability("education.view");const params=await searchParams,focus=z.uuid().safeParse(params.focus),enrollmentId=z.uuid().safeParse(params.enrollmentId);
 const [initial,detail,enrollment]=await Promise.all([listApplications({enrollmentId:enrollmentId.success?enrollmentId.data:undefined}).catch(()=>null),focus.success?getApplication(focus.data).catch(()=>null):null,enrollmentId.success?getEnrollment(enrollmentId.data).catch(()=>null):null]);
 return <div className="page-stack"><WorkspaceTabs items={familyTabs} active="/applications"/><ApplicationsWorkspace initial={initial} initialDetail={detail} enrollment={enrollment} initialEnrollmentId={enrollmentId.success?enrollmentId.data:""} create={params.create==="1"}/></div>;
}

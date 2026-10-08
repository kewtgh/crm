"use client";
import {useEffect,useState} from "react";
import type {StaffRemovalEligibility,StaffUserRecord} from "@/lib/admin-users-repository";
import {apiFetch} from "@/lib/api-client";
import {useReceiptMutation} from "@/hooks/use-receipt-mutation";
import {useI18n} from "./i18n-provider";
import {AccessibleDrawer,InlineMessage} from "./ui";

export function StaffRemovalDialog({user,onClose,onSaved}:{user:StaffUserRecord;onClose:()=>void;onSaved:()=>Promise<void>}) {
 const {locale,t}=useI18n(),en=locale==="en";
 const [eligibility,setEligibility]=useState<StaffRemovalEligibility|null>(null),[loadError,setLoadError]=useState(false),[confirmed,setConfirmed]=useState(false),[accepted,setAccepted]=useState(false),[notice,setNotice]=useState("");
 const mutation=useReceiptMutation(`/api/admin/users/${user.id}/removal`,"admin.users.updateFailed");
 const load=async()=>{setLoadError(false);try{setEligibility(await apiFetch<StaffRemovalEligibility>(`/api/admin/users/${user.id}/removal`));}catch{setLoadError(true);}};
 useEffect(()=>{let alive=true;void apiFetch<StaffRemovalEligibility>(`/api/admin/users/${user.id}/removal`).then(result=>{if(alive)setEligibility(result);}).catch(()=>{if(alive)setLoadError(true);});return()=>{alive=false;};},[user.id]);
 const blockers:Record<string,[string,string]>={
  DEACTIVATION_REQUIRED:["Suspend this account first, then clear or reassign business links and check again.","请先停用账户，再清理或转交业务关联后重新检查。"],
  PROTECTED_ACCOUNT:["This account is protected. You cannot remove yourself or bypass administrator safeguards.","该账户受保护，不能删除自己或绕过管理员保护规则。"],
  MULTI_WORKSPACE_ACCOUNT:["This identity belongs to multiple workspaces. Suspend access here and request controlled identity review.","该身份属于多个工作区。请先停用本工作区访问，并进行受控身份审查。"],
  EXTERNALLY_MANAGED_ACCOUNT:["This account is managed by an external directory. Use its governed offboarding process.","该账户由外部目录管理，请使用对应的受控离职流程。"],
  INVITATION_IN_FLIGHT:["An invitation is being delivered. Retry the eligibility check after delivery settles.","邀请正在投递，请等待投递状态确定后重新检查。"],
  BUSINESS_REFERENCES_EXIST:["Current business links still require this identity. Clear or reassign them, then check again; past activity alone does not permanently prevent deletion.","当前仍有业务关联。清理或转交后可重新检查删除资格；曾经有业务记录不代表永久禁止删除。"],
 };
 const refresh=async()=>{try{await onSaved();}catch{setNotice(t("audit.savedRefreshFailed"));}};
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(accepted){await refresh();return;}if(await mutation.send({confirmation:"REMOVE_UNUSED_ACCOUNT"})){setAccepted(true);setNotice(en?"Account removed. Refresh the directory.":"账户已删除，请刷新员工目录。");await refresh();}};
 return <AccessibleDrawer title={en?"Remove staff account":"删除员工账户"} description={`${user.displayNameZh} / ${user.displayNameEn}`} onClose={onClose} pending={mutation.pending||mutation.uncertain}><form onSubmit={submit}>
 {eligibility?.retentionMode==="AUDIT_IDENTITY"&&<InlineMessage type="info">{en?"Only historical audit references remain. Removal clears login, personal details and directory membership while retaining a disabled anonymous identity for audit.":"仅剩历史审计引用。删除将清除登录、个人资料及员工目录记录，仅保留不可登录的匿名审计身份。"}</InlineMessage>}
 <p>{en?"Suspension stops login while preserving business attribution. Removal permanently clears a cleared identity, credentials, sessions and its invitation queue. The server checks dependencies again on confirmation.":"停用会阻止登录并保留业务归属。删除会永久清理无业务引用的身份、凭据、会话和邀请队列。确认时服务器将再次检查依赖。"}</p>
 {loadError?<InlineMessage type="error">{en?"Eligibility check unavailable.":"暂时无法检查删除资格。"}<button type="button" className="secondary-button compact" onClick={()=>void load()}>{t("ux.management.refresh")}</button></InlineMessage>:!eligibility?<p role="status">{t("common.loading")}</p>:eligibility.status!=="DELETE_ELIGIBLE"?<InlineMessage type="info">{blockers[eligibility.status]?.[en?0:1]}</InlineMessage>:<fieldset disabled={mutation.pending||mutation.uncertain||accepted}><label className="checkbox-field"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{en?"I confirm permanent removal of this cleared account.":"我确认永久删除该无业务引用的账户。"}</span></label></fieldset>}
 {mutation.error&&<InlineMessage type="error">{mutation.error}</InlineMessage>}{notice&&<InlineMessage type="info">{notice}</InlineMessage>}
 <div className="drawer-actions"><button type="button" className="secondary-button" disabled={mutation.pending||mutation.uncertain} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" disabled={mutation.pending||(!accepted&&!mutation.uncertain&&(!confirmed||eligibility?.status!=="DELETE_ELIGIBLE"))}>{accepted?t("ux.management.refresh"):mutation.uncertain?t("enrollments.retry"):en?"Remove account":"删除账户"}</button></div>
 </form></AccessibleDrawer>;
}

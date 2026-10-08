"use client";
import {useState} from "react";
import type {StaffUserRecord} from "@/lib/admin-users-repository";
import type {AppRole} from "@/lib/roles";
import {roleMessageKey} from "@/lib/roles";
import {assignableStaffRoles} from "@/lib/staff-role-policy";
import {useReceiptMutation} from "@/hooks/use-receipt-mutation";
import {useI18n} from "./i18n-provider";
import {AccessibleDrawer,InlineMessage} from "./ui";
export function StaffRoleEditor({user,actorRole,onClose,onSaved}:{user:StaffUserRecord;actorRole:AppRole;onClose:()=>void;onSaved:()=>Promise<void>}){
 const {t,locale}=useI18n(),en=locale==="en",[role,setRole]=useState<AppRole>(user.role),[accepted,setAccepted]=useState(false),[notice,setNotice]=useState("");
 const mutation=useReceiptMutation(`/api/admin/users/${user.id}`,"admin.users.updateFailed");
 const refresh=async()=>{try{await onSaved();}catch{setNotice(t("audit.savedRefreshFailed"));}};
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(accepted){await refresh();return;}if(await mutation.send({role,expectedRole:user.role})){setAccepted(true);await refresh();}};
 return <AccessibleDrawer title={en?"Change staff role":"调整用户角色"} description={`${user.displayNameZh} / ${user.displayNameEn}`} onClose={onClose} pending={mutation.pending||mutation.uncertain}><form onSubmit={submit}>
 <p>{en?"Administrators can adjust employee roles. Only a Super Admin can assign or change administrator roles.":"管理员可调整普通员工角色；管理员及超级管理员角色只能由超级管理员授予或调整。"}</p>
 <fieldset className="follow-up-fields" disabled={mutation.pending||mutation.uncertain||accepted}><dl className="workspace-info-grid"><div><dt>{en?"Current role":"当前角色"}</dt><dd>{t(roleMessageKey[user.role])}</dd></div></dl><label className="field"><span>{en?"New role":"新角色"}</span><select value={role} onChange={e=>setRole(e.target.value as AppRole)}>{assignableStaffRoles(actorRole).map(value=><option key={value} value={value}>{t(roleMessageKey[value])}</option>)}</select></label>
 <p className="field-help">{en?"Saving revokes this user's existing sessions. They must sign in again. Role changes do not assign a manager or Revenue business authority.":"保存后，该用户现有会话将失效，需要重新登录。角色调整不会指定直属上级，也不会授予 Revenue 业务职权。"}</p></fieldset>
 {mutation.error&&<InlineMessage type="error">{mutation.error}</InlineMessage>}{notice&&<InlineMessage type="info">{notice}</InlineMessage>}
 <div className="drawer-actions"><button type="button" className="secondary-button" disabled={mutation.pending||mutation.uncertain} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" disabled={mutation.pending||(!accepted&&!mutation.uncertain&&role===user.role)}>{t(accepted?"ux.management.refresh":mutation.uncertain?"enrollments.retry":"common.save")}</button></div></form></AccessibleDrawer>;
}

"use client";
import {useState} from "react";
import type {StaffUserRecord} from "@/lib/admin-users-repository";
import {BUSINESS_FUNCTIONS,businessFunctionLabels,type BusinessFunction} from "@/lib/staff-business";
import {useReceiptMutation} from "@/hooks/use-receipt-mutation";
import {useI18n} from "./i18n-provider";
import {AccessibleDrawer,InlineMessage,StatusBadge} from "./ui";
import {DateInput} from "./structured-inputs";
import {roleMessageKey} from "@/lib/roles";

export function StaffBusinessEditor({user,onClose,onSaved}:{user:StaffUserRecord;onClose:()=>void;onSaved:()=>Promise<void>}) {
 const {locale,t}=useI18n(),en=locale==="en",profile=user.businessProfile;
 const [primary,setPrimary]=useState<BusinessFunction>(profile?.primaryFunction??"OTHER"),[additional,setAdditional]=useState<BusinessFunction[]>(profile?.additionalFunctions??[]),[eligible,setEligible]=useState(profile?.configuredEligibility??false),[date,setDate]=useState(new Date().toLocaleDateString("en-CA")),[reason,setReason]=useState(""),[accepted,setAccepted]=useState(false),[notice,setNotice]=useState("");
 const mutation=useReceiptMutation(`/api/admin/users/${user.id}/business`,"admin.users.updateFailed");
 const refresh=async()=>{try{await onSaved();}catch{setNotice(t("audit.savedRefreshFailed"));}};
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(accepted){await refresh();return;}if(await mutation.send({expectedRevision:profile?.revision??1,primaryFunction:primary,additionalFunctions:additional.filter(value=>value!==primary),salesEligible:eligible,effectiveFrom:date,reason})){setAccepted(true);await refresh();}};
 return <AccessibleDrawer title={en?"Staff responsibilities & reporting":"业务岗位与统计资格"} description={`${user.displayNameZh} / ${user.displayNameEn}`} onClose={onClose} pending={mutation.pending||mutation.uncertain}><form className="staff-business-editor" onSubmit={submit}>
 <section className="detail-section"><h3>{en?"Account & login":"账号与登录"}</h3><p>@{user.username} · {user.email}</p><StatusBadge tone={user.status==="ACTIVE"?"green":"gray"}>{t(user.status==="ACTIVE"?"common.active":"common.inactive")}</StatusBadge></section>
 <section className="detail-section"><h3>{en?"System access":"系统权限"}</h3><p>{t(roleMessageKey[user.role])}</p><p className="field-help">{en?"System roles and Revenue business designations are separate. This form grants neither administrator nor posting authority.":"系统角色与 Revenue 业务职权独立。本表单不会授予管理员或收入入账职权。"}</p></section>
 <section className="detail-section"><h3>{en?"Business function & reporting":"业务岗位与统计"}</h3><p>{en?"Teams / departments: ":"团队 / 部门："}{user.teams.map(team=>en?team.nameEn:team.nameZh).join(" / ")||t("admin.teams.unassigned")}</p><p>{en?"Currently eligible: ":"当前统计资格："}{profile?.salesEligible?(en?"Yes":"是"):(en?"No":"否")}{profile?.effectiveFrom?` · ${profile.effectiveFrom}`:""}</p>
 <fieldset className="follow-up-fields" disabled={mutation.pending||mutation.uncertain||accepted}><label className="field"><span>{en?"Primary function":"主要岗位"}</span><select aria-label={en?"Primary function":"主要岗位"} value={primary} onChange={e=>setPrimary(e.target.value as BusinessFunction)}>{BUSINESS_FUNCTIONS.map(value=><option key={value} value={value}>{businessFunctionLabels[value][en?0:1]}</option>)}</select></label>
 <fieldset><legend>{en?"Additional functions":"兼任岗位"}</legend><div className="workspace-info-grid">{BUSINESS_FUNCTIONS.filter(value=>value!==primary).map(value=><label key={value}><input type="checkbox" checked={additional.includes(value)} onChange={e=>setAdditional(old=>e.target.checked?[...old,value]:old.filter(x=>x!==value))}/>{businessFunctionLabels[value][en?0:1]}</label>)}</div></fieldset>
 <label className="field"><span>{en?"Participates in sales reporting":"参与销售统计"}</span><select aria-label={en?"Participates in sales reporting":"参与销售统计"} value={eligible?"YES":"NO"} onChange={e=>setEligible(e.target.value==="YES")}><option value="NO">{en?"No":"否"}</option><option value="YES">{en?"Yes — requires Sales function and active team":"是 — 须有销售岗位和有效团队"}</option></select></label>
 <label className="field"><span>{en?"Effective date (today or future)":"生效日期（今日或未来）"}</span><DateInput aria-label={en?"Effective date (today or future)":"生效日期（今日或未来）"} required value={date} onChange={e=>setDate(e.target.value)}/></label><label className="field"><span>{en?"Approval reason / reference":"批准原因 / 依据"}</span><textarea required minLength={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label></fieldset>
 <p className="field-help">{en?"Approved period scopes and historical contribution facts remain unchanged. Current roster and forecasts require active eligibility and team membership. Company cash, contracts and Revenue are unaffected.":"已批准期间的人员范围和历史贡献事实保持不变。当前人员名单和预测需满足有效资格及团队关系。公司收款、合同和收入不受影响。"}</p>
 {profile?.updatedAt&&<p className="field-help">{en?"Last change":"最近修改"}：{profile.updatedAt} · {profile.updatedBy?.slice(0,8)}<br/>{profile.reason}</p>}</section>
 {mutation.error&&<InlineMessage type="error">{mutation.error}</InlineMessage>}{notice&&<InlineMessage type="info">{notice}</InlineMessage>}
 <div className="drawer-actions"><button type="button" className="secondary-button" disabled={mutation.pending||mutation.uncertain} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" disabled={mutation.pending}>{t(accepted?"ux.management.refresh":mutation.uncertain?"enrollments.retry":"common.save")}</button></div>
 </form></AccessibleDrawer>;
}

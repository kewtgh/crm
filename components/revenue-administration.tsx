"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {apiFetch} from '@/lib/api-client';
import {useReceiptMutation} from '@/hooks/use-receipt-mutation';
import {useI18n} from './i18n-provider';
import {AccessibleDrawer,InlineMessage} from './ui';
type Profile={reporting_entity_id:string;legal_name:string;status:string;revision:number;can_submit?:boolean;can_approve?:boolean;accounting_framework:string;business_timezone:string;allowed_currencies:string[]};
type Configuration={timezone:string;profiles:Profile[];periods:{id:string;period_key:string;start_on:string;end_on:string;status:string}[];administrators:{id:string;name:string}[]};
export function RevenueAdministration({onClose}:{onClose:()=>void}){
 const {locale,t}=useI18n(),en=locale==='en',[snapshot,setSnapshot]=useState<Configuration|null>(null),[error,setError]=useState(false),[accepted,setAccepted]=useState(false),[entity]=useState(()=>crypto.randomUUID());
 const mutation=useReceiptMutation('/api/revenue/configuration','error.invalidInput');
 const load=async()=>{setError(false);try{setSnapshot(await apiFetch<Configuration>('/api/revenue/configuration'));setAccepted(false);}catch{setError(true);}};
 useEffect(()=>{void apiFetch<Configuration>('/api/revenue/configuration').then(setSnapshot).catch(()=>setError(true));},[]);
 const submit=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();if(accepted){await load();return;}const f=new FormData(e.currentTarget),value=(key:string)=>String(f.get(key)??'');const hasProfile=!!snapshot?.profiles.length;
 const payload=hasProfile?{command:'PERIOD_CREATE',entity:value('entity'),data:{period_key:value('period_key'),start_on:value('start_on'),end_on:value('end_on')}}:{command:'PROFILE_CREATE',entity,data:{owner:value('owner'),approver:value('approver'),profile:{...Object.fromEntries(['legal_name','accounting_framework','cutoff_reference','correction_reference','retention_reference','authority_reference'].map(k=>[k,value(k)])),business_timezone:snapshot?.timezone,allowed_currencies:value('currency').split(',').map(v=>v.trim().toUpperCase()).filter(Boolean)}}};
 if(await mutation.send(payload)){setAccepted(true);await load();}};
 const input=(key:string,zh:string,english:string,type='text')=><label className="field" key={key}><span>{en?english:zh}</span><input name={key} type={type} maxLength={200} required/></label>;
 return <AccessibleDrawer title={en?'Revenue configuration':'收入配置'} pending={mutation.pending||mutation.uncertain} onClose={onClose}>
 <p>{en?'Administrators configure the reporting entity and accounting periods. Activation, policy review and posting still require designated authorities and independent review.':'管理员可以配置报告主体与会计期间。启用、政策审批和收入过账仍需指定业务职权及独立审核。'}</p>
 {error&&<InlineMessage type="error">{accepted?t('audit.savedRefreshFailed'):(en?'Revenue configuration could not be loaded.':'收入配置加载失败。')}<button className="secondary-button" onClick={()=>void load()}>{t('common.retry')}</button></InlineMessage>}
 {snapshot&&<><div className="revenue-admin-profiles">{snapshot.profiles.map(p=><article key={p.reporting_entity_id}><strong>{p.legal_name}</strong><span> · {p.status==='DRAFT'?(en?'Draft':'草稿'):p.status==='ACTIVE'?(en?'Active':'已启用'):(en?'Review / retired':'审核中／已停用')}</span><p>{p.accounting_framework} · {p.business_timezone} · {p.allowed_currencies.join(", ")}</p>{(p.can_submit||p.can_approve)&&<ProfileReview profile={p} onSaved={load}/>}</article>)}</div>
 <form onSubmit={submit}><fieldset className="follow-up-fields" disabled={mutation.pending||mutation.uncertain||accepted}><h3>{snapshot.profiles.length?(en?'Add accounting period':'添加会计期间'):(en?'Configure reporting entity':'配置报告主体')}</h3><div className="form-grid two-column">
 {snapshot.profiles.length?<><label className="field"><span>{en?'Reporting entity':'报告主体'}</span><select name="entity">{snapshot.profiles.map(p=><option value={p.reporting_entity_id} key={p.reporting_entity_id}>{p.legal_name}</option>)}</select></label>{input('period_key','期间名称','Period key')}{input('start_on','开始日期','Start date','date')}{input('end_on','结束日期','End date','date')}</>:<>{input('legal_name','报告主体名称','Reporting entity name')}{input('accounting_framework','会计准则','Accounting framework')}{input('currency','允许币种（逗号分隔，如 CNY,USD）','Allowed currencies (e.g. CNY,USD)')}{input('cutoff_reference','截止规则依据','Cutoff policy reference')}{input('correction_reference','更正规则依据','Correction policy reference')}{input('retention_reference','保留规则依据','Retention policy reference')}{input('authority_reference','业务职权授权依据','Authority reference')}{(['owner','approver'] as const).map(key=><label className="field" key={key}><span>{key==='owner'?(en?'Policy owner':'政策负责人'):(en?'Independent policy approver':'独立政策审批人')}</span><select name={key} required defaultValue=""><option value="">{en?'Select administrator':'选择管理员'}</option>{snapshot.administrators.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>)}<p>{en?'Business timezone':'业务时区'}: {snapshot.timezone}</p></>}
 </div></fieldset>{mutation.error&&<InlineMessage type="error">{mutation.error}<Link href="/mfa-challenge" target="_blank">{en?'Verify identity':'验证身份'}</Link></InlineMessage>}
 <div className="drawer-actions"><button className="primary-button" disabled={mutation.pending}>{t(accepted?'ux.management.refresh':mutation.uncertain?'enrollments.retry':'common.save')}</button></div></form>
 {snapshot.periods.length>0&&<section><h3>{en?'Accounting periods':'会计期间'}</h3>{snapshot.periods.map(p=><p key={p.id}>{p.period_key} · {p.start_on} — {p.end_on} · {p.status==='OPEN'?(en?'Open':'开放'):(en?'Closed':'已关闭')}</p>)}</section>}</>}
 </AccessibleDrawer>;
}

function ProfileReview({profile,onSaved}:{profile:Profile;onSaved:()=>Promise<void>}){
 const {locale,t}=useI18n(),en=locale==='en',mutation=useReceiptMutation('/api/revenue/configuration','error.invalidInput'),[accepted,setAccepted]=useState(false);
 const submit=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!accepted){const reference=String(new FormData(e.currentTarget).get('reference')??'');if(!await mutation.send({command:profile.can_submit?'PROFILE_SUBMIT':'PROFILE_APPROVE',entity:profile.reporting_entity_id,data:{revision:profile.revision,reference}}))return;setAccepted(true);}await onSaved();};
 return <form onSubmit={submit}><fieldset disabled={mutation.pending||mutation.uncertain||accepted}><label className="field"><span>{en?'Review reference':'审核依据'}</span><input name="reference" required maxLength={200}/></label></fieldset>{mutation.error&&<InlineMessage type="error">{mutation.error}</InlineMessage>}<button className="secondary-button" disabled={mutation.pending}>{accepted?t('ux.management.refresh'):mutation.uncertain?t('enrollments.retry'):profile.can_submit?(en?'Submit configuration for review':'提交配置审核'):(en?'Approve and activate configuration':'批准并启用配置')}</button></form>;
}

"use client";
import {useState} from 'react';
import {SearchableSelect,InlineMessage} from './ui';
import {apiFetch} from '@/lib/api-client';
import {useI18n} from './i18n-provider';
import {useRemoteSearch} from '@/hooks/use-remote-search';
export function ImportReferencePanel(){
 const {locale}=useI18n(),zh=locale==='zh-CN';
 const [kind,setKind]=useState('ORGANIZATION'),[selected,setSelected]=useState(''),[options,setOptions]=useState<Array<{value:string;label:string}>>([]),[token,setToken]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const runSearch=useRemoteSearch();
 const names:Record<string,[string,string]>={ORGANIZATION:['机构','Organization'],HOUSEHOLD:['家庭','Household'],CONTACT:['联系人','Contact'],STUDENT:['学生','Student'],PRODUCT:['产品','Product'],COHORT:['批次','Cohort'],STAFF:['负责人','Staff owner'],OPPORTUNITY:['商机','Opportunity']};
 const search=async(q:string)=>{const result=await runSearch(signal=>apiFetch<{items:Array<{id:string;label:string}>}>(`/api/imports/references?kind=${kind}&q=${encodeURIComponent(q)}`,{signal}));if(!result.current)return;if('error' in result){setError('INVALID_REFERENCE');return;}setOptions(result.value.items.map(item=>({value:item.id,label:item.label})));};
 const issue=async()=>{setPending(true);setError('');try{const result=await apiFetch<{token:string}>('/api/imports/references',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,recordId:selected})});setToken(result.token);}catch{setError('INVALID_REFERENCE');}finally{setPending(false);}};
 return <div className="import-reference-panel"><InlineMessage type="info">{zh?'需要关联已有机构、家长或学生，或更新已有资料时，先在这里查找并选择，再将临时关联编号复制到模板对应列。新建且无需关联资料可以跳过。编号限当前用户使用，24 小时内有效。':'To link or update an existing record, select it here and copy its temporary reference into the matching template column. Skip this step for new records without links. References are private to you and expire after 24 hours.'}</InlineMessage><div className="form-grid three-column"><label className="field"><span>{zh?'要关联哪类资料':'Type of existing record'}</span><select value={kind} onChange={e=>{setKind(e.target.value);setSelected('');setToken('');setOptions([]);}}>{Object.entries(names).map(([key,label])=><option key={key} value={key}>{label[zh?0:1]}</option>)}</select></label><SearchableSelect label={zh?'搜索并选择已有资料':'Find an existing record'} value={selected} options={options} onSearch={q=>void search(q)} onChange={value=>{setSelected(value);setToken('');}}/><button className="secondary-button" type="button" disabled={!selected||pending} onClick={()=>void issue()}>{zh?'生成临时关联编号':'Create temporary reference'}</button></div>{token&&<label className="field"><span>{zh?'临时关联编号（可复制，24小时有效）':'Authorized reference (copy)'}</span><input readOnly value={token} onFocus={e=>e.target.select()}/></label>}{error&&<InlineMessage type="error">{error}</InlineMessage>}</div>;
}

"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useI18n} from './i18n-provider';
import {apiFetch} from '@/lib/api-client';
import {revenueLabel} from '@/lib/revenue-workspace-labels';
import type {RevenueWorkspace} from '@/lib/revenue-workspace';
export function ContractRevenueSection({contractId}:{contractId:string}){
 const {locale}=useI18n();const [data,setData]=useState<RevenueWorkspace|null>(null);const [failed,setFailed]=useState(false);
 useEffect(()=>{let current=true;void apiFetch<RevenueWorkspace>(`/api/revenue?contract=${contractId}`).then(v=>{if(current)setData(v);}).catch(()=>{if(current)setFailed(true);});return()=>{current=false;};},[contractId]);
 const l=(key:string)=>revenueLabel(locale,key);
 if(failed)return <p role="alert">{l('failed')}</p>;
 if(!data)return <p role="status">{l('loading')}</p>;
 if(data.state!=='READY')return <p>{l(data.state)}</p>;
 return <section aria-label={l('title')}><p>{l('immutable')}</p><dl>{data.contracts?.flatMap(c=>['contracted','receivable','collected','applied_cash','outstanding','refunded'].map(key=><div key={`${c.contract_id}:${key}`}><dt>{l(key)}</dt><dd>{String(c.currency)} {String(c[key])}</dd></div>))}{data.recognized?.map(r=><div key={String(r.currency)}><dt>{l('recognized')}</dt><dd>{String(r.currency)} {String(r.amount)}</dd></div>)}{data.commissions?.map(r=><div key={String(r.currency)}><dt>{l('commission')}</dt><dd>{String(r.currency)} {String(r.amount)}</dd></div>)}</dl><Link className="secondary-button" href={`/finance/revenue?contract=${contractId}&tab=services`}>{l('lineage')}</Link></section>;
}

import type {FinanceOverview} from '../../lib/phase2-repository';
import {managementFixture} from './management-overview';
export const financeId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function supportChartFixture(){const data=managementFixture().studentSuccess;data.period.from="2026-05-01";data.trends=Array.from({length:6},(_,i)=>({month:`2026-${String(i+5).padStart(2,'0')}`,counts:{checkins:i+2,risksObserved:i%3,outcomes:i}}));return data;}
export function financeChartFixture():FinanceOverview{return {
 quotes:[{id:financeId(1),number:'QUOTE-FICTION-0001',organizationId:financeId(2),organizationZh:'示例培训机构',organizationEn:'Fictional Training Organization',currency:'CNY',validUntil:'2027-01-01',status:'DRAFT',version:1,subtotal:1000,discount:0,total:1000,termsZh:'示例条款',termsEn:'Fictional terms',bundleId:null,bundleVersion:null,baseCurrency:'CNY',baseTotal:1000,createdAt:'2026-10-01'}],quoteTotal:1,
 contracts:[{id:financeId(3),number:'CONTRACT-FICTION-0001',currency:'CNY',value:1000,status:'ACTIVE',hasSchedule:true}],contractTotal:1,
 receivables:[{id:financeId(4),contractId:financeId(3),contractNumber:'CONTRACT-FICTION-0001',installment:1,dueDate:'2026-10-08',amount:1000,paidAmount:700,status:'PARTIAL',currency:'CNY'}],receivableTotal:1,
 payments:[{id:financeId(5),contractId:financeId(3),scheduleId:financeId(4),amount:700,refundedAmount:0,currency:'CNY',status:'CONFIRMED',reference:'FICTIONAL-RECEIPT',paidAt:'2026-10-08'}],paymentTotal:1,
 refunds:[],refundTotal:0,reconciliations:[],reconciliationTotal:0,pageSize:10,risk:{openReceivables:1,overdueReceivables:0,pendingRefunds:0,reconciliationExceptions:0},products:[{id:financeId(6),code:'FICTION',nameZh:'示例课程',nameEn:'Fictional Course'}],bundles:[],exchangeRates:[],
 collectionSeries:[{currency:'CNY',month:'2026-09',scheduled:'1000.00',settled:'700.00'},{currency:'CNY',month:'2026-10',scheduled:'1500.00',settled:'600.00'},{currency:'USD',month:'2026-10',scheduled:'200.00',settled:'100.00'}]
};}

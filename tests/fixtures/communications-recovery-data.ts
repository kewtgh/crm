export const communicationId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const communicationRows=Array.from({length:23},(_,n)=>({id:communicationId(n+1),contactId:communicationId(90),contactZh:"示例联系人",contactEn:"Fictional Contact",email:"recipient@example.test",subject:`Fictional conversation ${n+1}`,channel:"EMAIL",purpose:n%2?"EVENT":"SERVICE",status:n===2?"CLOSED":"OPEN",lastMessageAt:"2026-10-25T01:02:03.123456+00:00"}));
export const communicationMessages=(id:string)=>[
 {id:communicationId(Number(id.slice(-12))*100+1),direction:"INBOUND",body:"Fictional inbound service context.",deliveryStatus:"RECEIVED",failureCode:"",retryAllowed:false,retryToken:"2026-10-25T01:02:03.123456+00:00",attemptCount:1,providerAttemptCount:0,createdAt:"2026-10-25T01:02:03.123456+00:00"},
 {id:communicationId(Number(id.slice(-12))*100+2),direction:"OUTBOUND",body:"Fictional response awaiting a verified delivery decision.",deliveryStatus:"FAILED",failureCode:"PROVIDER_REJECTED",retryAllowed:true,retryToken:"2026-10-25T01:02:03.123456+00:00",attemptCount:1,providerAttemptCount:1,createdAt:"2026-10-25T01:02:03.123456+00:00"},
];
export const communicationInitial={items:communicationRows.slice(0,20),total:communicationRows.length,page:1,pageSize:20};
export const communicationInitialThread={...communicationRows[0],messages:communicationMessages(communicationId(1)),messageTotal:2,messagePage:1,messagePageSize:20};

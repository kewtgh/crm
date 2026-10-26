export const discoveryId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const discoveryContract={id:discoveryId(70),customer:"示例客户",english:"Fictional Customer",start:"2026-01-01",end:"2030-01-01",days:1000,value:100,currency:"USD",owner:"Fictional Advisor",status:"ACTIVE" as const,relationLevel:1 as const};
export const discoveryContractSummary={validCount:1,renewalCount:0,under30Count:0,riskCount:0,renewalByCurrency:{},lifecycle:{draft:0,active:1,preparing:0,negotiating:0,risk:0},renewalAlerts:[]};

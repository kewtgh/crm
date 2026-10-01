"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "./i18n-provider";
import { DateInput, MoneyInput } from "./structured-inputs";

export function InstallmentsEditor() {
  const {t}=useI18n();
  const [rows,setRows]=useState(()=>[{id:crypto.randomUUID(),dueDate:"",amount:""}]);
  const change=(id:string,field:"dueDate"|"amount",value:string)=>setRows(current=>current.map(row=>row.id===id?{...row,[field]:value}:row));
  return <fieldset className="installment-editor"><legend>{t("finance.installments")}</legend>
    {rows.map((row,index)=><div className="installment-row" key={row.id}>
      <label className="field"><span>{t("finance.installmentDate")} · {index+1}</span><DateInput name={`installmentDate-${row.id}`} value={row.dueDate} onChange={event=>change(row.id,"dueDate",event.target.value)} required/></label>
      <label className="field"><span>{t("finance.installmentAmount")} · {index+1}</span><MoneyInput name={`installmentAmount-${row.id}`} value={row.amount} onValueChange={value=>change(row.id,"amount",value)} min={0.01} required/></label>
      <button className="icon-button" type="button" disabled={rows.length===1} aria-label={`${t("finance.removeInstallment")} · ${index+1}`} onClick={()=>setRows(current=>current.filter(item=>item.id!==row.id))}><Trash2 size={17}/></button>
    </div>)}
    <button className="secondary-button" type="button" disabled={rows.length>=24} onClick={()=>setRows(current=>[...current,{id:crypto.randomUUID(),dueDate:"",amount:""}])}><Plus size={16}/>{t("finance.addInstallment")}</button>
    <input type="hidden" name="installments" value={JSON.stringify(rows.map(({dueDate,amount})=>({dueDate,amount:Number(amount)})))}/>
  </fieldset>;
}

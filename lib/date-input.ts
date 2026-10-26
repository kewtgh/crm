export type DateInputType="date"|"time"|"datetime-local"|"month";

export function normalizeDateInput(value:string,type:DateInputType,currentYear=new Date().getFullYear()):string|null{
 const input=value.trim();if(!input)return "";
 if(type==="time"){
  const parts=/^(\d{2}):?(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/.exec(input);
  if(!parts||Number(parts[1])>23||Number(parts[2])>59||Number(parts[3]??0)>59)return null;
  return `${parts[1]}:${parts[2]}${Number(parts[3]??0)||Number(parts[4]??0)?`:${parts[3]}${parts[4]??""}`:""}`;
 }
 if(type==="datetime-local"){
  const [date,time,...extra]=input.split("T");if(!date||!time||extra.length)return null;
  const day=normalizeDateInput(date,"date",currentYear),clock=normalizeDateInput(time,"time",currentYear);
  return day&&clock?`${day}T${clock}`:null;
 }
 const expanded=type==="date"&&/^\d{4}$/.test(input)?`${String(currentYear).padStart(4,"0")}-${input.slice(0,2)}-${input.slice(2)}`:input;
 const parts=(type==="month"?/^(\d{4})-(\d{2})$/:/^(\d{4})-(\d{2})-(\d{2})$/).exec(expanded);
 if(!parts)return null;
 const year=Number(parts[1]),month=Number(parts[2]);if(year<1||month<1||month>12)return null;
 if(type==="month")return expanded;
 const leap=year%4===0&&(year%100!==0||year%400===0),maximum=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
 return Number(parts[3])>=1&&Number(parts[3])<=maximum?expanded:null;
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, Clock3, Plus, X,ChevronLeft,ChevronRight } from "lucide-react";
import { useI18n } from "./i18n-provider";
import { academicYearOptions, amountError, COMMON_CURRENCIES, formatAmount, normalizeAmount, parseTokens } from "@/lib/structured-inputs";

type InputProps=React.InputHTMLAttributes<HTMLInputElement>;

export function BilingualNameHint() {
  const {t}=useI18n();
  const hint=useRef<HTMLElement>(null);
  const id=useId();
  useEffect(()=>{
    const form=hint.current?.closest("form");
    if(!form)return;
    const fields:Array<[HTMLInputElement,HTMLInputElement]>=[];
    for(const [zh,en] of [["nameZh","nameEn"],["displayNameZh","displayNameEn"],["titleZh","titleEn"]]){
      const chinese=form.querySelector<HTMLInputElement>(`input[name="${zh}"]`);
      const english=form.querySelector<HTMLInputElement>(`input[name="${en}"]`);
      if(chinese&&english)fields.push([chinese,english]);
    }
    const validate=()=>fields.forEach(([chinese,english])=>{
      const empty=!chinese.value.trim()&&!english.value.trim();
      chinese.setCustomValidity(empty?t("input.nameRequired"):"");
    });
    const reset=()=>queueMicrotask(validate);
    fields.flat().forEach(field=>field.setAttribute("aria-describedby",[field.getAttribute("aria-describedby"),id].filter(Boolean).join(" ")));
    validate();
    form.addEventListener("input",validate);
    form.addEventListener("change",validate);
    form.addEventListener("reset",reset);
    return()=>{
      form.removeEventListener("input",validate);form.removeEventListener("change",validate);form.removeEventListener("reset",reset);
      fields.flat().forEach(field=>{field.setCustomValidity("");const description=field.getAttribute("aria-describedby")?.split(" ").filter(value=>value!==id).join(" ");if(description)field.setAttribute("aria-describedby",description);else field.removeAttribute("aria-describedby");});
    };
  },[t,id]);
  return <small ref={hint} id={id} className="name-pair-hint"><span className="required-indicator">* </span>{t("input.nameHelp")} ({t("input.required")})</small>;
}

export function DateInput({type="date",...props}:Omit<InputProps,"type">&{type?:"date"|"datetime-local"|"time"|"month"}) {
  const {t,locale}=useI18n();
  const input=useRef<HTMLInputElement>(null);
  const wrap=useRef<HTMLSpanElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false),[view,setView]=useState<"days"|"month"|"year">("days"),[cursor,setCursor]=useState(()=>new Date());
  const id=useId();
  useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(!wrap.current?.contains(event.target as Node))setOpen(false);};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close);},[open]);
  const show=()=>{
    if(type==="time"){try{input.current?.showPicker();}catch{input.current?.focus();}return;}
    const raw=input.current?.value.slice(0,10);setCursor(raw?new Date(`${raw.length===7?`${raw}-01`:raw}T12:00:00`):new Date());setView("days");setOpen(value=>!value);
  };
  const pick=(date:Date)=>{
    const field=input.current;if(!field)return;
    const value=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
    const next=type==="month"?value.slice(0,7):type==="datetime-local"?`${value}T${field.value.slice(11)||"09:00"}`:value;
    // Native value setter + bubbling input/change retains React controlled inputs
    // and native FormData/required/min/max validation.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(field,next);
    field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new Event("change",{bubbles:true}));
    setOpen(false);trigger.current?.focus();
  };
  const year=cursor.getFullYear(),month=cursor.getMonth(),first=new Date(year,month,1).getDay(),days=new Date(year,month+1,0).getDate();
  const available=(date:Date)=>{const value=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`.slice(0,type==="month"?7:10);return(!props.min||value>=String(props.min).slice(0,value.length))&&(!props.max||value<=String(props.max).slice(0,value.length));};
  return <span ref={wrap} className="date-picker-control" onKeyDown={event=>{if(open&&event.key==="Escape"){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOpen(false);}}>
    <input {...props} ref={input} type={type}/><button ref={trigger} className="date-picker-trigger" type="button" disabled={props.disabled||props.readOnly} aria-label={t(type==="time"?"input.chooseTime":"input.chooseDate")} aria-expanded={type!=="time"?open:undefined} aria-controls={type!=="time"?id:undefined} onClick={show}>{type==="time"?<Clock3 size={18}/>:<CalendarDays size={18}/>}</button>
    {open&&<span id={id} className="date-calendar" role="group" aria-label={t("input.chooseDate")}><span className="date-calendar-heading"><button type="button" aria-label={t("customerOps.previousMonth")} onClick={()=>setCursor(new Date(year,month-1,1))}><ChevronLeft size={16}/></button><button type="button" onClick={()=>setView(view==="month"?"days":"month")}>{new Intl.DateTimeFormat(locale,{month:"long"}).format(cursor)}</button><button type="button" onClick={()=>setView(view==="year"?"days":"year")}>{year}</button><button type="button" aria-label={t("customerOps.nextMonth")} onClick={()=>setCursor(new Date(year,month+1,1))}><ChevronRight size={16}/></button></span>
      {view==="month"&&<span className="date-month-grid">{Array.from({length:12},(_,i)=><button type="button" key={i} onClick={()=>{const date=new Date(year,i,1);setCursor(date);setView("days");if(type==="month")pick(date);}}>{new Intl.DateTimeFormat(locale,{month:"short"}).format(new Date(year,i,1))}</button>)}</span>}
      {view==="year"&&<span className="date-year-grid">{Array.from({length:151},(_,i)=>1900+i).map(value=><button type="button" key={value} aria-pressed={value===year} onClick={()=>{setCursor(new Date(value,month,1));setView("days");}}>{value}</button>)}</span>}
      {view==="days"&&<span className="date-day-grid">{Array.from({length:7},(_,i)=><small key={`week-${i}`}>{new Intl.DateTimeFormat(locale,{weekday:"short"}).format(new Date(2026,5,7+i))}</small>)}{Array.from({length:first},(_,i)=><span key={`blank-${i}`}/>)}{Array.from({length:days},(_,i)=>{const date=new Date(year,month,i+1);return <button type="button" key={i} disabled={!available(date)} aria-label={new Intl.DateTimeFormat(locale,{dateStyle:"full"}).format(date)} onClick={()=>pick(date)}>{i+1}</button>;})}</span>}
    </span>}
  </span>;
}

type MoneyProps=Omit<InputProps,"type"|"onChange"|"value"|"defaultValue">&{value?:string|number;defaultValue?:string|number;onValueChange?:(value:string)=>void;precision?:number};
export function MoneyInput({name,value,defaultValue="",onValueChange,min=0,max,precision=2,...props}:MoneyProps) {
  const {locale,t}=useI18n();
  const [draft,setDraft]=useState(String(defaultValue));
  const [focused,setFocused]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const raw=value===undefined?draft:String(value);
  const invalid=amountError(raw,Number(min),max===undefined?undefined:Number(max),precision);
  useEffect(()=>{input.current?.setCustomValidity(invalid?t("input.amountInvalid"):"");},[invalid,t]);
  useEffect(()=>{const form=input.current?.form;const reset=()=>{setDraft(String(defaultValue));setFocused(false);};form?.addEventListener("reset",reset);return()=>form?.removeEventListener("reset",reset);},[defaultValue]);
  return <><input {...props} name={undefined} step={undefined} ref={input} data-money-input={name??"amount"} type="text" inputMode="decimal" value={focused?raw:formatAmount(raw,locale)} aria-invalid={invalid||undefined} onFocus={event=>{setFocused(true);props.onFocus?.(event);}} onBlur={event=>{setFocused(false);props.onBlur?.(event);}} onChange={event=>{const next=normalizeAmount(event.target.value);setDraft(next);onValueChange?.(next);}}/>{name&&<input type="hidden" name={name} value={raw} disabled={props.disabled}/>}</>;
}

export function CurrencySelect({defaultValue="CNY",...props}:React.SelectHTMLAttributes<HTMLSelectElement>) {
  const {locale}=useI18n();
  const selected=String(props.value??defaultValue??"");
  const codes=[...new Set([...COMMON_CURRENCIES,...Intl.supportedValuesOf("currency"),...(selected?[selected]:[])])];
  const labels=new Intl.DisplayNames(locale,{type:"currency"});
  const label=(code:string)=>{try{return labels.of(code)??code;}catch{return code;}};
  return <select {...props} {...(props.value===undefined?{defaultValue}:{})}>{codes.map(code=><option key={code} value={code}>{code} · {label(code)}</option>)}</select>;
}

export function OptionInput({options,...props}:InputProps&{options:readonly string[]}) {
  const id=useId();
  return <><input {...props} list={id}/><datalist id={id}>{options.map(option=><option key={option} value={option}/>)}</datalist></>;
}

export function AcademicYearInput({value,defaultValue="",onChange,placeholder,...props}:React.SelectHTMLAttributes<HTMLSelectElement>&{placeholder?:string}) {
  const {t}=useI18n();
  const current=String(value??defaultValue??"");
  return <select {...props} onChange={onChange} {...(value===undefined?{defaultValue}:{value})}><option value="">{placeholder??t("input.chooseAcademicYear")}</option>{academicYearOptions(current).map(year=><option value={year} key={year}>{year}</option>)}</select>;
}

export function YearInput({value,defaultValue="",...props}:React.SelectHTMLAttributes<HTMLSelectElement>) {
  const selected=String(value??defaultValue??"");
  const years=[...new Set([...(selected?[selected]:[]),...Array.from({length:151},(_,i)=>String(1900+i))])].sort();
  return <select {...props} {...(value===undefined?{defaultValue}:{value})}><option value="">—</option>{years.map(year=><option key={year}>{year}</option>)}</select>;
}

export function TagsInput({name,defaultValue="",placeholder,maxItems=name==="courseCategories"?40:30,maxTokenLength=name==="courseCategories"?100:name==="interests"?80:60}:{name:string;defaultValue?:string;placeholder?:string;maxItems?:number;maxTokenLength?:number}) {
  const {t}=useI18n();
  const [tokens,setTokens]=useState(()=>parseTokens(defaultValue,Infinity));
  const [draft,setDraft]=useState("");
  const input=useRef<HTMLInputElement>(null);
  // Include the pending token in FormData even if the user submits without clicking +.
  const all=parseTokens([...tokens,draft].join(","),Infinity);
  const invalid=all.length>maxItems||all.some(token=>token.length>maxTokenLength);
  const error=t("input.tagsInvalid",{count:maxItems,length:maxTokenLength});
  const add=()=>{if(invalid){input.current?.reportValidity();return;}setTokens(all);setDraft("");};
  useEffect(()=>{input.current?.setCustomValidity(invalid?error:"");},[invalid,error]);
  useEffect(()=>{const form=input.current?.form;const reset=()=>{setTokens(parseTokens(defaultValue,Infinity));setDraft("");};form?.addEventListener("reset",reset);return()=>form?.removeEventListener("reset",reset);},[defaultValue]);
  return <span className="tags-input"><span className="tag-values">{tokens.map(token=><span key={token}>{token}<button type="button" aria-label={`${t("input.removeTag")}: ${token}`} onClick={()=>setTokens(values=>values.filter(value=>value!==token))}><X size={14}/></button></span>)}</span><span className="tag-entry"><input ref={input} value={draft} maxLength={5000} aria-invalid={invalid||undefined} placeholder={placeholder} onChange={event=>setDraft(event.target.value)} onBlur={add} onKeyDown={event=>{if(event.key==="Enter"||event.key===","){event.preventDefault();add();}}}/><button className="icon-button" type="button" disabled={!draft.trim()||invalid} aria-label={t("input.addTag")} onClick={add}><Plus size={16}/></button></span>{invalid&&<small className="field-error">{error}</small>}<input type="hidden" name={name} value={all.join(", ")}/></span>;
}

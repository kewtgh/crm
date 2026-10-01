"use client";

import { useState } from "react";
import { useI18n } from "./i18n-provider";
import { AcademicYearInput, CurrencySelect, DateInput, MoneyInput, OptionInput, TagsInput, YearInput } from "./structured-inputs";
import { CURRICULUM_OPTIONS, GRADE_OPTIONS, LANGUAGE_OPTIONS, normalizeAmount } from "@/lib/structured-inputs";

function RepairDate({name,value}:{name:string;value:string}) {
  const {t}=useI18n();
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  const [date,setDate]=useState(valid?value:"");
  const [edited,setEdited]=useState(false);
  // An invalid imported date remains in the payload until explicitly changed;
  // rendering a picker must not silently erase the original source data.
  return <><DateInput value={date} onChange={event=>{setDate(event.target.value);setEdited(true);}}/><input type="hidden" name={name} value={edited?date:value}/>{value&&!valid&&!edited&&<><small className="field-error">{t("imports.originalValue",{value})}</small><button type="button" className="text-button" onClick={()=>{setDate("");setEdited(true);}}>{t("input.clearDate")}</button></>}</>;
}

export function ImportRepairField({field,value}:{field:string;value:string}) {
  if(field==="birthDate")return <RepairDate name={field} value={value}/>;
  if(field==="annualIncomeAmount")return <MoneyInput name={field} defaultValue={normalizeAmount(value)} min={0}/>;
  if(field==="incomeCurrency")return <CurrencySelect name={field} defaultValue={value.toUpperCase()||"CNY"}/>;
  if(field==="academicYear")return <AcademicYearInput name={field} defaultValue={value} required/>;
  if(field==="foundedYear")return <YearInput name={field} defaultValue={value}/>;
  if(field==="interests"||field==="courseCategories")return <TagsInput name={field} defaultValue={value}/>;
  if(field==="currentGrade")return <OptionInput name={field} defaultValue={value} options={GRADE_OPTIONS} required/>;
  if(field==="preferredLanguage")return <OptionInput name={field} defaultValue={value} options={LANGUAGE_OPTIONS}/>;
  if(field==="curriculum")return <OptionInput name={field} defaultValue={value} options={CURRICULUM_OPTIONS}/>;
  const enums:Record<string,string[]>={affiliationType:["INDEPENDENT","EDUCATION_GROUP","GOVERNMENT","UNIVERSITY","RELIGIOUS","OTHER"],preferredContactMethod:["EMAIL","PHONE","SMS","WECHAT","WHATSAPP","IN_PERSON"],preferredLearningStyle:["UNSPECIFIED","VISUAL","AUDITORY","READ_WRITE","KINESTHETIC","MIXED"]};
  if(enums[field])return <select name={field} defaultValue={value}><option value="">—</option>{[...new Set([...enums[field],...(value?[value]:[])])].map(option=><option key={option} value={option}>{option}</option>)}</select>;
  if(["studentCount","facultyCount","campusCount"].includes(field))return <input name={field} type="number" min={0} step={1} defaultValue={value}/>;
  if(field.endsWith("Markdown"))return <textarea name={field} defaultValue={value} rows={4} data-markdown="true"/>;
  return <input name={field} defaultValue={value} type={field==="email"?"email":field==="phone"?"tel":field==="website"?"url":"text"} maxLength={field==="nameZh"?120:field==="nameEn"?160:undefined}/>;
}

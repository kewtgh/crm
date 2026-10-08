"use client";
import {useRef,type TextareaHTMLAttributes} from "react";
import {useI18n} from "./i18n-provider";

export const nextActionSuggestions=[
 ["确认需求与目标","Confirm needs and goals"],
 ["电话联系并确认下一步","Call to agree on next steps"],
 ["预约沟通或拜访","Arrange a meeting or visit"],
 ["发送资料并确认收到","Send information and confirm receipt"],
 ["收集或补充所需材料","Collect or complete required documents"],
 ["准备方案或报价","Prepare a proposal or quote"],
 ["确认方案反馈与决策时间","Confirm feedback and decision timeline"],
 ["确认报名或申请进度","Check enrollment or application progress"],
 ["回访支持效果与后续需求","Review support outcomes and follow-up needs"],
 ["约定下次联系时间","Agree on the next contact date"],
] as const;

/** Suggestions assist existing canonical text fields; they do not execute actions. */
export function NextActionInput(props:TextareaHTMLAttributes<HTMLTextAreaElement>){
 const {locale}=useI18n(),field=useRef<HTMLTextAreaElement>(null);
 const english=props.name?.endsWith("En")||(!props.name?.endsWith("Zh")&&locale==="en");
 return <span className="next-action-input"><textarea {...props} ref={field}/><select aria-label={locale==="en"?"Add a suggested next action":"添加常用下一步行动"} value="" disabled={props.disabled||props.readOnly} onChange={event=>{
  const input=field.current;if(!input||!event.target.value)return;
  const suggestion=event.target.value;
  const value=input.value.trim()?`${input.value.trim()}\n${suggestion}`:suggestion;
  if(props.maxLength&&value.length>props.maxLength){input.focus();return;}
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set?.call(input,value);
  input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));input.focus();
 }}><option value="">{locale==="en"?"Choose an action to add · or write your own":"选择常用行动添加，也可自由填写"}</option>{nextActionSuggestions.map(([zh,en])=><option key={en} value={english?en:zh}>{english?en:zh}</option>)}</select></span>;
}

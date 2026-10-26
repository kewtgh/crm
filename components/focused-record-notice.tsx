"use client";
import Link from "next/link";
import {useI18n} from "./i18n-provider";
import {InlineMessage} from "./ui";

export function FocusedRecordNotice({found,href}:{found:boolean;href:string}){
 const {t}=useI18n();
 return <InlineMessage type={found?"info":"warning"}>{t(found?"discovery.focused":"discovery.missing")} <Link href={href}>{t("discovery.clearFocus")}</Link></InlineMessage>;
}

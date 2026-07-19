"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";

export default function ErrorBoundary({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
  const {t}=useI18n();
  useEffect(()=>{console.error("Lumina route error",error.digest??error.message);},[error]);
  return <main className="boundary-page"><section className="surface data-state" role="alert"><span className="data-state-icon"><AlertTriangle size={24}/></span><div><h1>{t("common.dataUnavailable")}</h1><p>{t("common.dataLoadError")}{error.digest?` · ${t("common.requestId")}: ${error.digest}`:""}</p></div><button className="secondary-button" type="button" onClick={reset}><RefreshCcw size={16}/>{t("common.retry")}</button></section></main>;
}

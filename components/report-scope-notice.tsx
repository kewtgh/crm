"use client";
import type {ReportFilter} from "@/lib/management-trend-contract";
import {useI18n} from "./i18n-provider";
export function ReportScopeNotice({filter}:{filter:ReportFilter}){const {t}=useI18n();return filter.reportMetric?<p className="field-help">{t("management.matchingScope")}: {t(`management.metric.${filter.reportMetric}`)}{filter.from&&filter.to?` · ${filter.from}–${filter.to}`:""}{filter.currency?` · ${filter.currency}`:""}</p>:null;}

"use client";

import { Sparkles, Workflow } from "lucide-react";
import { WorkspaceTabs } from "./workspace-tabs";
import { useI18n } from "./i18n-provider";
import { useCapability } from "./app-user-context";

export function AssistanceWorkspaceHeader({ active }: {active: string}) {
  const { t } = useI18n();
  const canReview = useCapability("ai.review"), canAutomate = useCapability("automation.manage");
  return <section className="surface assistance-header">
    <header><p className="eyebrow">{t("ui.assistanceEyebrow")}</p><h1>{t("nav.assistance")}</h1><p>{t("ui.assistanceHelp")}</p></header>
    <div className="assistance-guide">
      {canReview && <article><Sparkles size={20}/><div><h2>{t("nav.ai")}</h2><p>{t("ui.suggestionsHelp")}</p><small>{t("ui.suggestionsSteps")}</small></div></article>}
      {canAutomate && <article><Workflow size={20}/><div><h2>{t("nav.automation")}</h2><p>{t("ui.automationHelp")}</p><small>{t("ui.automationSteps")}</small></div></article>}
    </div>
    <WorkspaceTabs active={active} items={[{href:"/ai",label:"nav.ai",capability:"ai.review"},{href:"/automation",label:"nav.automation",capability:"automation.manage"}]}/>
  </section>;
}

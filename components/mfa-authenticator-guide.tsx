"use client";

import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { useId } from "react";
import { useI18n } from "@/components/i18n-provider";

export function MfaAuthenticatorGuide({ headingLevel = "h3" }: { headingLevel?: "h2" | "h3" }) {
  const { t } = useI18n();
  const headingId = useId();
  const Heading = headingLevel;

  return (
    <aside className="mfa-guide" aria-labelledby={headingId}>
      <div className="mfa-guide__heading">
        <ShieldCheck aria-hidden="true" size={20} />
        <div>
          <Heading id={headingId}>{t("settings.mfaGuideTitle")}</Heading>
          <p>{t("settings.mfaGuideIntro")}</p>
        </div>
      </div>
      <ul className="mfa-guide__apps">
        <li><span className="mfa-guide__app-icon microsoft"><Smartphone aria-hidden="true" size={20} /></span><span><b>{t("settings.mfaGuideMicrosoftName")}</b><small>{t("settings.mfaGuideMicrosoftHelp")}</small></span></li>
        <li><span className="mfa-guide__app-icon google"><span aria-hidden="true">G</span></span><span><b>{t("settings.mfaGuideGoogleName")}</b><small>{t("settings.mfaGuideGoogleHelp")}</small></span></li>
        <li><span className="mfa-guide__app-icon one-password"><KeyRound aria-hidden="true" size={20} /></span><span><b>{t("settings.mfaGuideOnePasswordName")}</b><small>{t("settings.mfaGuideOnePasswordHelp")}</small></span></li>
      </ul>
      <p className="mfa-guide__policy">{t("settings.mfaGuidePolicy")}</p>
      <p className="mfa-guide__warning">{t("settings.mfaGuideWarning")}</p>
    </aside>
  );
}

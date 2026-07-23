"use client";

import { Clock3, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
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
        <li><Smartphone aria-hidden="true" size={18} /><span>{t("settings.mfaGuideMicrosoft")}</span></li>
        <li><Clock3 aria-hidden="true" size={18} /><span>{t("settings.mfaGuideGoogle")}</span></li>
        <li><KeyRound aria-hidden="true" size={18} /><span>{t("settings.mfaGuideOnePassword")}</span></li>
      </ul>
      <p className="mfa-guide__policy">{t("settings.mfaGuidePolicy")}</p>
      <p className="mfa-guide__warning">{t("settings.mfaGuideWarning")}</p>
    </aside>
  );
}

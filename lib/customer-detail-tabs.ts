import type { CustomerSubject } from "./customer-operations";

export function customerDetailTabs(subject: CustomerSubject, hasPrivacy = false, hasHistory = false) {
  return [
    { key: "overview", label: "customerOps.tab.overview" },
    { key: "followUp", label: "customerOps.tab.followUp" },
    { key: "business", label: "customerOps.tab.business" },
    ...(subject === "CONTACT" ? [] : [{ key: "people", label: subject === "ORGANIZATION" ? "detail.organizationContacts" : "detail.familyMembers" }]),
    ...(hasPrivacy ? [{ key: "privacy", label: "customerOps.tab.privacy" }] : []),
    ...(hasHistory ? [{ key: "history", label: "customer360.events" }] : []),
  ];
}

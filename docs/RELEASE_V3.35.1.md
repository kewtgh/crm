# Lumina CRM v3.35.1

- Next-action fields in leads, customer follow-up, opportunities, education business,
  journeys and student support offer common bilingual actions while retaining free text.
  Selecting a suggestion appends to existing content; it does not create a task or send a message.
- Revenue workspace headings display one icon. Communication tabs use the same icon as their heading.
- Student placement correction aligns selection and actions on desktop and reorganizes on narrow screens.

Suggestions continue using the existing text fields; no new action classification is persisted.
Migration head remains 126 with 131 SQL files. Authorization, Revenue and Commission semantics are unchanged.

Verification: targeted icon contracts, typecheck, lint, build, public privacy and 28 fixture-backed
Chromium page/viewport checks passed for the implementation. Release metadata checks cover this patch version.
No Production access, push or deployment is included.

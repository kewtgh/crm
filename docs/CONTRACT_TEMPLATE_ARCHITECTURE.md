# Contract Template Architecture — v3.24 Contract Operations

Release version: **3.24.0**. Contract Operations = Template Governance + Deterministic Generation +
Uploaded Evidence Extraction + Human Review. It does not replace the canonical Contract lifecycle.
Phase 1 established the template contract; Phase 2 adds source-aware deterministic DOCX preview,
approved-only generation, immutable evidence and authorized download. Phase 3 adds immutable external
originals, text DOCX/PDF extraction, canonical conflict reporting and document-only review with zero CRM Apply.
The two repository v1 masters remain **DRAFT**. No business/legal approval has been supplied.
Their unresolved required fields still block production. See [Phase 1 verification](V324_PHASE1_VERIFICATION.md),
[template review](CONTRACT_TEMPLATE_REVIEW.md) and [Phase 2 verification](V324_PHASE2_VERIFICATION.md).

The sections below through the field tables retain the Phase 1 decisions and mapping. The Phase 2 and Phase 3
contracts at the end supersede earlier deferrals for generation and extraction respectively.

## Historical Phase 1 Gap Analysis / exact reuse decision

| Existing capability | Finding | Decision |
|---|---|---|
| Contract versions | `contract_versions` requires an existing customer Contract and captures its business snapshot | Keep authoritative; never insert a fake Contract just to hold a template |
| Contract documents | Requires `contract_id`, version, storage path/checksum; status is GENERATING/GENERATED/SIGNED/SUPERSEDED/FAILED | Not Template identity or approval; not a Channel Agreement artifact store without forward design |
| Channel Agreement / versions / rules | Real Organization-linked Agreement; signed_on/effective dates/revision; fixed or percentage rules | Read context through source access in Phase 2; do not duplicate or amend these facts |
| Generated jobs / approvals | Existing CONTRACT_EXPORT approval/job, CSV/XLSX/PDF tabular output | Reuse queue/worker infrastructure in Phase 2; DOCX format and template/source lineage are not yet supported, so no claim of a working production pipeline |
| Object storage | Existing local/S3 object store, exports/ key namespace, MIME/checksum, signed download | Reuse implementation after source-bound authorization; immutable template retention is distinct from expiring export jobs |
| Approval domain | CONTRACT_SIGN/CONTRACT_EXPORT are existing business approvals | Template approval is a separate meaning; reuse authorization capabilities, not a fake CONTRACT_SIGN record. Persisted approval routing is deferred to the generation integration design |
| Company legal identity | Scoped inspection found no complete approved internal-company legal entity/signatory registry | `REQUIRES_APPROVED_STATIC_TEMPLATE_VALUE`; no .env authority, no copied company from reference, no new business table |
| Itinerary / service package | Product/Cohort supply names/dates, not the reference's exact service itinerary or fee components | Confirm document-only content; never create a Product itinerary/cost domain as a side effect |

The schema cannot naturally represent Template + Version using Contract history. For this bounded
phase, repository-versioned configuration provides that identity safely: no online editing is
implemented and both versions remain DRAFT. Therefore **NO NEW MIGRATION**. A future requirement
for workspace-managed uploads/approvals or Channel-generated artifact lineage must independently
justify a minimal forward change; this document does not approve that change. All 113 migrations,
including frozen 106–108, retain their raw bytes.

## Contract Type Contract

| Type | Canonical parent/context | Template key |
|---|---|---|
| CHANNEL_RECRUITMENT_AGREEMENT | Channel Agreement Version → Agreement → Organization; explicitly scoped Commission Rule / Product / Cohort | channel-recruitment |
| STUDENT_PROGRAM_SERVICE_AGREEMENT | Customer Contract → explicit active Contract–Enrollment link → Enrollment → Student / Cohort / Product; Household buyer context | student-program |

The Channel type is not a Customer Contract. Current fixed-commission draft applies only to
FIXED_PER_ENROLLMENT; a percentage Rule must produce an explicit unsupported-basis blocker.
No source Contract/Agreement is fetched by the offline preview utility. All fixture context IDs
are synthetic. Future adapters must validate workspace, source access, selected relation and
source revision before resolving any canonical field, not trust browser-supplied IDs/values.

## Party Model

Channel: Company Legal Entity is 甲方; confirmed Channel legal organization is 乙方.
Organization's display name is shown separately as its CRM reference. Authorized contact/coordinator
and actual legal signatory are independently confirmed; Primary Contact is never substituted.

Student service: Company Legal Entity is 乙方. Buyer/signing party is explicitly confirmed and
shown separately from the Household display name. Participant is derived through Student's
existing Contact identity. Guardian requirement and capacity are explicit human confirmations;
for a confirmed guardian-required fixture, missing name/capacity blocks eligibility. An explicitly
confirmed adult/no-guardian case displays Not applicable; missing requirement never implies adult.
Enrollment supplies delivery context and is not a contract party.

The reference B's generic 甲方 rights/duties mix payment/signing and participation. The master
retains the reference clauses and adds an explicit blocking review field. Staff/legal review must
resolve the actual buyer/participant allocation before approval; this phase does not silently
rewrite all obligations or assert that Household itself is a legal person.

Company name, registration identifier, address and signing authority remain a technical debt:
they need approved static configuration or a later approved legal-entity model. Current fixtures
use invented values. They are not approved company information. Never read legal identities from .env.

## Template Version Contract

`catalog.templates` defines stable key/type/name identities. `catalog.versions` references the
identity by key and positive version number; their pair is unique. Active version is nullable
and must be APPROVED when set. Both current active pointers are NULL.

Each version records original filename/SHA256, master path/SHA256, DOCX format, field schema,
effective dates (currently unknown), review items, created metadata and separate approval
actor/time/reference. DRAFT → APPROVED → RETIRED are governance states, not Customer Contract
or Agreement transitions. These v1 records have no approval and no production usage.

The validator implements approved-only eligibility with complete approval evidence and no
unresolved required/unsupported fields. **APPROVED content/mapping is immutable even before use**,
a stricter rule than merely preventing edits after generation. Referenced versions are likewise
immutable. Retirement changes governance status only; content/checksum stays intact. A change
requires the next DRAFT version and a new immutable master path/checksum. Never overwrite a
previously approved artifact or delete documents generated from a retired version.

Repository DRAFT creation is not business approval or an Audit event. Future approval/retirement
must be executed by a trusted authenticated actor and record only template/version IDs, hashes,
changed fields, actor and reason. The manifest cannot claim approval merely because CI passed.

## Field Mapping

The authoritative machine contract is each version's `fields` array. Every field has stable key,
zh/en label, type, required/conditional requirement, category, canonical source/path, sensitive
flag, validation and `allow_override=false`. CANONICAL facts are not editable during generation;
USER_CONFIRMED values need explicit actor confirmation; TEMPLATE_CONSTANT belongs to a version;
DERIVED is deterministic; UNSUPPORTED stays blocked, including when fixture text is supplied.

No document-only canonical override is introduced. Missing required fields yield
MISSING_REQUIRED_FIELD and a visible Missing placeholder in preview, never an empty string.
Confirmation cannot impersonate CANONICAL values. Unknown inputs/mappings are rejected.
Optional Guardian fields become explicitly Not applicable only after the requirement is confirmed false.

Agreement signing date currently maps strictly to `channel_agreement_versions.signed_on`.
If not recorded, this draft cannot silently use today/created_at. Phase 2 must explicitly decide
whether an unsigned-document proposed date needs a separately named confirmation field; it must
not override a known signed_on fact. Contract signing date has no inspected canonical equivalent
and is document confirmation, independently of Contract effective/service dates.

## Rendering Contract

Master format is **DOCX**. Placeholder syntax is `{{stable.field_key}}`; labels are not keys.
The offline [template tool](../scripts/contract-template-tool.py) uses Python standard-library ZIP
and XML DOM; it is QA tooling, not a new deployed Python service. No dependency is installed.
It resolves only checked-in synthetic fixtures and writes only `work/v324-phase1/previews/`.

Lint validates exact master checksum, every XML/relationship part, body/table/header/footer
placeholders, unknown/malformed keys, unused required mappings and known reference literals.
Replacement operates on concatenated paragraph text, then changes intersecting text nodes,
including a token split across runs. It preserves run properties and unaffected package parts.
Multi-line confirmed itinerary uses actual line breaks. Missing/unsupported values are red in
preview. DRAFT/PREVIEW ONLY is explicit; preview is not a signed/customer-ready document.

Money uses nonnegative decimal strings, two-place precision, and ISO currency; no floats/FX.
CNY has deterministic Chinese uppercase amount. USD/other ISO currencies retain currency plus
decimal amount; no RMB wording or ¥ default. Contract amount comes from Contract, never Product
price or 15,980 reference. Confirmed fee components must sum to that same Contract amount and
are customer fee components, not costs. Dates use ISO business dates, valid calendars and ordered
Cohort/effective ranges; no created_at substitution or fixed reference date.

Production DOCX → PDF legal-body rendering is **NOT IMPLEMENTED**. Existing tabular PDF export
is unrelated. Phase 1A local QA uses installed Microsoft Word LTSC 2024 read-only normal opens and
PDF export, then installed Windows.Data.Pdf page rasterization. This is not a deployed renderer,
dependency or claim of production PDF support. Actual pages, not XML tests alone, passed visual QA.

The DRAFT masters use a recurring bilingual DRAFT/PREVIEW header. Student headers use compact
9pt Arial/宋体 and permit long-company wrapping. Signatures are separate two-column non-splitting
forms with handwriting space; Student has a separate Guardian row. Short section headings stay
with following text, and the Student itinerary annex begins on an explicit page break on its heading.
No field-source, party, legal, amount or Commission semantics changed during visual closure.

## Generation Lineage — Phase 2 design, not a new fact table

Future generated documents must retain: workspace; source kind (CUSTOMER_CONTRACT or
CHANNEL_AGREEMENT_VERSION); source ID/revision and relevant immutable business version; explicit
Enrollment/Product/Cohort and Commission Rule/version references when applicable; template
key/version/master SHA256; resolved field evidence with canonical source paths; independently
confirmed document values/actor; generated actor/time; artifact key/MIME/bytes/SHA256.

These values are an immutable **generation input evidence snapshot**, not editable Student,
Product, Cohort, Contract or Commission facts. Later source edits create another Document Version;
they do not rewrite old evidence. Template Version ≠ Contract Version. Existing Customer
contract_documents cannot be used for Channel documents by inventing a customer Contract ID.
Phase 2 must choose a source-aware lineage extension and queue/format support within existing
infrastructure before exposing production generation; no second job queue is planned.

## Security / Privacy

Templates are internal repository files, outside public/. No application endpoint currently
offers upload/edit/approve/generate; no unauthenticated endpoint is added. Read policy is active
workspace staff with contracts.view. Draft governance uses existing catalog.manage and
contracts.manage; approval/retirement additionally uses approvals.decide and AAL2.
[Policy helper](../scripts/lib/contract-template-governance.mjs) and tests cover the existing
roles; future server handlers must derive these claims from trusted membership/session state.
The policy contract is not proof of an implemented online approval/RLS workflow.

Future Generated Document access must inherit its actual Contract/Agreement parent, with
additional Commission money permission where needed. Organization visibility never grants hidden
Contact/Student access. Object-key validity or a file token cannot replace source authorization.
Current storage permits exports/ keys; new artifact namespaces or retention behavior require
separate Phase 2 design. Template retention must not follow temporary export expiration.

Master templates contain placeholders, not real customer/Student/guardian/contact/bank information.
Fixtures are explicitly synthetic. Legal clauses mentioning passport/health are not extracted
into Student Success, a medical model or Audit. Future generated artifacts and input evidence
may contain PII and must respect source privacy export/cleanup plus approved legal retention;
operational copies must not bypass identity erasure through document snapshots.

## Frozen Boundaries / Non-scope

Contract Template ≠ Contract / Channel Agreement; Template Version ≠ Contract Version;
Generated Document ≠ Signed Document / Approved Contract; Uploaded Document ≠ Business Fact;
Downloaded Document ≠ Contract Status Change; Template Approved ≠ Contract Approved / Agreement ACTIVE;
Participant ≠ Buyer; Student ≠ Guardian; Contact ≠ Legal Signatory; Enrollment ≠ Contract Party;
Contract Amount ≠ Product Price; Reference Template Amount ≠ Canonical Amount;
Commission Clause ≠ Commission Engine Rule; Document Extraction Candidate / AI inference ≠ Business Fact.

No production generation/signing/e-sign provider; no upload/extraction/PDF text parsing/OCR/AI;
no automatic Contract/Agreement/Payment/Refund/Commission/Enrollment change; no Revenue, Target,
Forecast or Management AI. Phase 1A clears the technical reader/rendering prerequisite for Phase 2
infrastructure work. It does not approve either DRAFT template. Production generation must remain
APPROVED-only with unresolved review/mapping blockers addressed through explicit approval.

## Per-field contract tables

The following tables are generated from catalog.json. All allow_override values are false.
Generation editing is allowed only as explicit confirmation for USER_CONFIRMED values; supplying
UNSUPPORTED text never clears its blocker. TEMPLATE_CONSTANT/DERIVED cannot be manually supplied.
Labels, type, sources, exact paths, requirements, validation and sensitivity remain in the catalog.

### CHANNEL_RECRUITMENT_AGREEMENT — v1 DRAFT

| Field key / label | Category / type | Required | Canonical source / exact path | Generation edit / override | Sensitive | Validation / unsupported |
|---|---|---|---|---|---|---|
| template.review_notice / 模板审阅提示 | TEMPLATE_CONSTANT / text | YES | TEMPLATE_VERSION / catalog.versions.fields.value | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| company.legal_name / 经确认的公司法律名称 | USER_CONFIRMED / text | YES | REQUIRES_APPROVED_STATIC_TEMPLATE_VALUE / generation.confirmed.company.legal_name | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| company.address / 公司注册地址 | USER_CONFIRMED / text | YES | REQUIRES_APPROVED_STATIC_TEMPLATE_VALUE / generation.confirmed.company.address | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| company.signatory / 经确认的公司签约代表 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.company.signatory | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| company.phone / 公司联系号码 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.company.phone | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| company.email / 公司联系邮箱 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.company.email | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| program.name / 正式项目名称 | CANONICAL / text | YES | PRODUCT / products.name_zh OR name_en (explicit locale) | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| program.institution_name / 经确认的项目举办/证书单位 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.program.institution_name | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| cohort.name / 正式批次名称 | CANONICAL / text | YES | COHORT / product_cohorts.name_zh OR name_en (explicit locale) | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| bank.beneficiary / 经确认的收/付款账户户名 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.bank.beneficiary | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| bank.institution / 经确认的开户银行 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.bank.institution | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| bank.account / 经确认的银行账号 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.bank.account | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| company.registration_identifier / 经确认的公司注册标识 | USER_CONFIRMED / text | YES | REQUIRES_APPROVED_STATIC_TEMPLATE_VALUE / generation.confirmed.company.registration_identifier | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| agreement.reference / 代理协议编号 | CANONICAL / text | YES | CHANNEL_AGREEMENT / channel_agreements.agreement_code | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| channel.organization_name / 关联机构档案名称 | CANONICAL / text | YES | ORGANIZATION / organizations.name_zh OR name_en (explicit locale) | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| channel.legal_name / 确认的渠道签约法律名称 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.channel.legal_name | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| channel.address / 渠道机构确认地址 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.channel.address | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| channel.representative / 授权对接代表（非自动签约代表） | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.channel.representative | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| channel.signatory / 确认的渠道签约代表 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.channel.signatory | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| channel.phone / 渠道联系号码 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.channel.phone | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| channel.email / 渠道联系邮箱 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.channel.email | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| agreement.signing_date / 协议版本记录的签署日期 | CANONICAL / date | YES | AGREEMENT_VERSION / channel_agreement_versions.signed_on | NO; override=false | False | ISO YYYY-MM-DD; actual calendar date; none |
| agreement.signing_place / 确认的签署地点 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.agreement.signing_place | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| agreement.effective_from / 协议生效日 | CANONICAL / date | YES | AGREEMENT_VERSION / channel_agreement_versions.effective_from | NO; override=false | False | ISO YYYY-MM-DD; actual calendar date; none |
| agreement.effective_to / 协议终止日 | CANONICAL / date | YES | AGREEMENT_VERSION / channel_agreement_versions.effective_to | NO; override=false | False | ISO YYYY-MM-DD; actual calendar date; none |
| company.background_clause / 经确认的公司背景条款 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.company.background_clause | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| program.description / 经确认的项目描述 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.program.description | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| agreement.review_clause / 经确认的年度评估和续约安排 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.agreement.review_clause | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| commission.amount / 固定每 Enrollment 佣金 | CANONICAL / money | YES | COMMISSION_RULE / channel_commission_rules.fixed_amount; basis_type=FIXED_PER_ENROLLMENT | NO; override=false | False | nonnegative decimal string; <=12 integer/2 fractional digits; none |
| commission.currency / 固定佣金币种 | CANONICAL / currency | YES | COMMISSION_RULE / channel_commission_rules.fixed_currency; basis_type=FIXED_PER_ENROLLMENT | NO; override=false | False | 3 uppercase letters; no FX; none |
| commission.eligibility_clause / 登记/Offer/满一个月未退出条款 | UNSUPPORTED / text | YES | REFERENCE_LEGAL_CLAUSE_NOT_ENGINE_FACT / reference.A.paragraphs.53-56 | Review text only; remains BLOCKED | False | nonempty; max 5000; no placeholder injection; UNSUPPORTED_BY_CURRENT_COMMISSION_ENGINE |
| commission.settlement_condition / 经确认的正常入读结算条件 | UNSUPPORTED / text | YES | REFERENCE_LEGAL_CLAUSE_NOT_ENGINE_FACT / reference.A.paragraph.67 | Review text only; remains BLOCKED | False | nonempty; max 5000; no placeholder injection; UNSUPPORTED_BY_CURRENT_COMMISSION_ENGINE |
| commission.payment_terms / 经确认的支付期限 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.commission.payment_terms | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| channel.coordinator / 确认的项目对接人/职位 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.channel.coordinator | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| company.invoice_details / 经确认的开票信息 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.company.invoice_details | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |

### STUDENT_PROGRAM_SERVICE_AGREEMENT — v1 DRAFT

| Field key / label | Category / type | Required | Canonical source / exact path | Generation edit / override | Sensitive | Validation / unsupported |
|---|---|---|---|---|---|---|
| template.review_notice / 模板审阅提示 | TEMPLATE_CONSTANT / text | YES | TEMPLATE_VERSION / catalog.versions.fields.value | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| company.legal_name / 经确认的公司法律名称 | USER_CONFIRMED / text | YES | REQUIRES_APPROVED_STATIC_TEMPLATE_VALUE / generation.confirmed.company.legal_name | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| company.address / 公司注册地址 | USER_CONFIRMED / text | YES | REQUIRES_APPROVED_STATIC_TEMPLATE_VALUE / generation.confirmed.company.address | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| company.signatory / 经确认的公司签约代表 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.company.signatory | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| company.phone / 公司联系号码 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.company.phone | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| company.email / 公司联系邮箱 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.company.email | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| program.name / 正式项目名称 | CANONICAL / text | YES | PRODUCT / products.name_zh OR name_en (explicit locale) | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| program.institution_name / 经确认的项目举办/证书单位 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.program.institution_name | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| cohort.name / 正式批次名称 | CANONICAL / text | YES | COHORT / product_cohorts.name_zh OR name_en (explicit locale) | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| bank.beneficiary / 经确认的收/付款账户户名 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.bank.beneficiary | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| bank.institution / 经确认的开户银行 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.bank.institution | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| bank.account / 经确认的银行账号 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.bank.account | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| company.registration_identifier / 经确认的公司注册标识 | USER_CONFIRMED / text | YES | REQUIRES_APPROVED_STATIC_TEMPLATE_VALUE / generation.confirmed.company.registration_identifier | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| contract.reference / 客户合同编号 | CANONICAL / text | YES | CUSTOMER_CONTRACT / contracts.contract_number | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| buyer.household_name / 关联家庭档案名称 | CANONICAL / text | YES | HOUSEHOLD / contracts.household_id -> households.name_zh OR name_en | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| buyer.signing_name / 确认的购买/签署主体名称 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.buyer.signing_name | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| participant.name / 参与学生名称（来自关联联系人） | CANONICAL / text | YES | STUDENT_CONTACT / enrollment.student_id -> students.person_id -> contacts.name_zh OR name_en | NO; override=false | True | nonempty; max 5000; no placeholder injection; none |
| guardian.required / 本次是否需要监护签署 | USER_CONFIRMED / boolean | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.guardian.required | Confirm only; override=false | False | explicit true/false; none |
| guardian.name / 确认的监护人姓名 | USER_CONFIRMED / text | IF guardian.required = true | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.guardian.name | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| guardian.capacity / 确认的监护签署身份 | USER_CONFIRMED / text | IF guardian.required = true | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.guardian.capacity | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| program.start_on / 批次项目开始日 | CANONICAL / date | YES | COHORT / enrollment.cohort_id -> product_cohorts.start_on | NO; override=false | False | ISO YYYY-MM-DD; actual calendar date; none |
| program.end_on / 批次项目结束日 | CANONICAL / date | YES | COHORT / enrollment.cohort_id -> product_cohorts.end_on | NO; override=false | False | ISO YYYY-MM-DD; actual calendar date; none |
| contract.amount / 正式合同金额 | CANONICAL / money | YES | CUSTOMER_CONTRACT / contracts.contract_value | NO; override=false | False | nonnegative decimal string; <=12 integer/2 fractional digits; none |
| contract.currency / 正式合同币种 | CANONICAL / currency | YES | CUSTOMER_CONTRACT / contracts.currency | NO; override=false | False | 3 uppercase letters; no FX; none |
| contract.amount_words / 金额的确定性币种格式 | DERIVED / text | YES | DETERMINISTIC_FORMATTING / contract.amount + contract.currency; CNY Chinese uppercase; others ISO decimal | NO; override=false | False | nonempty; max 5000; no placeholder injection; none |
| contract.signing_date / 确认的合同签署日期 | USER_CONFIRMED / date | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.contract.signing_date | Confirm only; override=false | False | ISO YYYY-MM-DD; actual calendar date; none |
| service.accommodation / 经确认的住宿标准 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.service.accommodation | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| service.program_component / 经确认的项目服务金额分项 | USER_CONFIRMED / money | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.service.program_component | Confirm only; override=false | False | nonnegative decimal string; <=12 integer/2 fractional digits; none |
| service.logistics_component / 经确认的住宿/交通等金额分项 | USER_CONFIRMED / money | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.service.logistics_component | Confirm only; override=false | False | nonnegative decimal string; <=12 integer/2 fractional digits; none |
| payment.terms / 经确认的付款方式/期限条款 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.payment.terms | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| payment.method / 经确认的付款操作说明 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.payment.method | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| buyer.notice_contact / 经确认的甲方通知方式 | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.buyer.notice_contact | Confirm only; override=false | True | nonempty; max 5000; no placeholder injection; none |
| program.itinerary / 经确认的本批次行程（文档内容） | USER_CONFIRMED / text | YES | EXPLICIT_DOCUMENT_CONFIRMATION / generation.confirmed.program.itinerary | Confirm only; override=false | False | nonempty; max 5000; no placeholder injection; none |
| review.party_capacity / 甲方/参与者条款语义审阅 | UNSUPPORTED / text | YES | UNRESOLVED_REFERENCE_PARTY_CAPACITY / reference.B.general clauses | Review text only; remains BLOCKED | False | nonempty; max 5000; no placeholder injection; REQUIRES_BUSINESS_OR_LEGAL_REVIEW |

## Phase 2 schema / exact reuse decision

| Existing infrastructure | Phase 2 decision |
|---|---|
| `contract_documents` | Retained unchanged: customer-only parent and signing lifecycle are unsuitable for Channel artifacts. No fake Customer Contract. |
| `contract_versions` | Authoritative immutable Customer business version supplies `source_revision`; not a generated-document version. |
| Channel Agreement versions/rules | Authoritative explicit version/revision and selected rule; no rule recalculation or mutation. |
| `generated_jobs` and leased worker | Extended with DOCX generation origin; same claim/backoff/lease, no second queue or fake export/sign approval. |
| Local/S3 storage | Reused with `contract-documents/` namespace, SHA256 and MIME; retained documents have no temporary-export expiry. |
| Approval | Existing request types do not express Template approval. Reuse `catalog.manage`, `contracts.manage`, `approvals.decide`, membership and AAL2, with dedicated minimal maker/checker governance. |
| Company legal/static values | Versioned approved encrypted workspace document configuration, not a corporate ERP or `.env` legal authority. |

Migration **109** adds workspace-scoped template-version identity, encrypted configuration versions and
source-aware `generated_contract_documents`. The catalog template key is the long-lived identity; a
workspace/key/version is unique. Active approved version is a unique per-key pointer equivalent.
This minimum model is necessary because the customer-only schema cannot represent Channel lineage,
independent template approval or payload-bound generation evidence. Migrations 106–108 are unchanged.

## Production Generation Contract

`CUSTOMER_CONTRACT` uses an explicit active Contract–Enrollment link. `CHANNEL_AGREEMENT_VERSION`
uses the exact selected Agreement version and a selected same-version Commission Rule plus explicit
Product/Cohort. No first Enrollment/rule selection, allocation by enrollment count, or identity inference.
Source parent/workspace permissions are checked at resolve, request, worker input/completion and download.
The parent identity is checked by an insert trigger as well as the request mutation.

Production requires an **APPROVED, active** compatible Template Version, approval actor/time,
checksum-matching registered master bytes, approved static configuration, no unresolved review items,
no unsupported fields, every applicable required field and the current expected source revision.
DRAFT is restricted to authorized admin/AAL2 preview; RETIRED cannot start new work. Historic generated
files remain downloadable after retirement if source access and privacy still permit them.

Approved definitions, bytes/mappings and constants cannot be overwritten. Register a new DRAFT version
and approve it separately. Governance API registration reads the server catalog, never an arbitrary
client path. These real v1s cannot be approved while their legal/commission/party blockers remain.

## Source Resolver / field confirmation

Customer fields resolve Contract amount/currency/reference, Household context, selected Enrollment,
Student Contact, Product and Cohort dates. Participant is not the signing buyer. Buyer, signing capacity,
Guardian requirement and conditional Guardian values remain explicit document confirmations.
Shared Contract amount is the full canonical amount, never silently divided or overridden.

Channel fields resolve Agreement reference, selected version dates, visible Organization display context,
Product/Cohort and the explicit Rule's fixed amount/currency. The current master only accepts
`FIXED_PER_ENROLLMENT`; percentage basis and another version's rule are blocked. Organization Contact
is not inferred to be a legal signatory. Offer/month-enrolled/non-withdrawn conditions remain unsupported
by the Commission engine, regardless of narrative confirmation.

Company fields in both types and the **company receiving bank in the Student type** come from approved
workspace configuration. **Channel `bank.*` is the Channel party's settlement account** and remains
explicit USER_CONFIRMED input. It never consumes the company receiving account. This type-specific
resolution preserves Phase 1 party mapping despite identical field keys in separate schemas.
Static configuration approval supplies confirmation actor/time; it is not a canonical Contract override.

Unknown keys, CANONICAL overrides, derived inputs, constants and static-company overrides are rejected.
Required misses become explicit red preview markers or a production rejection. Guardian=false renders
Not applicable; no contact fallback. CNY uppercase uses deterministic decimal/BigInt formatting; USD
never uses RMB uppercase. Fee components must sum to canonical Contract amount. Dates are real calendar
dates and ordered; XML/control/token injection is rejected. Itinerary/payment clauses remain document-only.

## Generation Evidence / Document Version

The request snapshot retains only consumed canonical values, declared confirmations, selected context,
source references, revision and confirmer/time. The worker stores field evidence with key/category,
resolved/display values, actual mapped source ID/path, applicable revision and confirmer provenance.
It does not dump whole Student, Household, Contract or Organization records. Canonical related fields
may not have domain revision numbers; their exact consumed value and source ID are pinned in evidence.
Only the Contract/Agreement version is the optimistic concurrency authority; related edits do not rewrite
an accepted immutable input snapshot. Selected parent access/link validity is rechecked at work time.

Every artifact traces workspace, source kind/ID/revision, template key/version/SHA256, configuration
version, document version, actor/time, artifact key/SHA256/MIME/bytes. `document_version` counts explicit
new requests, independently from Contract versions. Reusing one actor/request key requires the exact
payload fingerprint and returns one identity, including after a source revision changes following success.
New stale requests conflict. Regeneration reason is bounded document metadata. Old evidence/file is immutable.

Ordinary list APIs expose lineage summaries only; no raw evidence or bank/Guardian values. Generated
input/evidence is privileged; it cannot update business facts. Audit includes IDs/status/template/hash
metadata only, never full confirmations, bank accounts, Guardian or document text.

## Job / Worker / retry contract

Request transaction atomically inserts document, immutable input, existing job and minimal request audit.
The document row's actor/key/fingerprint is the payload-bound receipt; true concurrent retries create
one logical version/job. Audit failure rolls back the whole request. Status is QUEUED → GENERATED or
FAILED; job retains its existing PROCESSING/READY/FAILED/DEAD attempt lifecycle. No SIGNED state.

Worker uses the production Node renderer, not Python/Word/LibreOffice. ZIP entries are sorted, timestamps
fixed, CRC verified and output stored deterministically; identical master/values produce byte-identical DOCX.
Cross-run tokens, paragraphs, tables, headers and footers are handled. Template SHA, XML, ZIP size/path,
unknown placeholders and unused required mappings fail closed. User input is never re-evaluated as a token.

Current unexpired job lease gates input, artifact reservation and completion. Attempt paths are recorded
before storage I/O. Retries use distinct lease paths but the same logical document. Old attempts are cleaned;
partial storage failure cannot create GENERATED without an artifact. Ambiguous completion is reconciled
by job+token before deleting anything. If DB reconciliation is unavailable, reserved paths remain tracked
for retry/erasure; no bearer download is exposed. Failed jobs use the existing bounded backoff, not a new queue.

Privacy erasure requeues only the affected document job. Erasure input/completion require its current
unexpired lease and matching workspace/document origin, not an arbitrary document ID or broad worker RLS.
The worker receives no direct document-table SELECT/UPDATE grant. Configuration/renderer/storage failures
are verified to enter FAILED and retry the same document/job without duplicate history.

## Storage / Retention / Download Authorization

`contract-documents/<workspace>/<document>/<lease>.docx` is a storage identity, not authorization.
Artifacts have no 24-hour tabular-export expiry. Download always rechecks current workspace/source access,
selected Enrollment visibility and generated/non-erased state, loads bytes and checks recorded hash/length.
It proxies a private/no-store DOCX response; direct local/S3 signed downloads for this namespace are denied.
Names are sanitized and Content-Disposition has a safe ASCII fallback and encoded Unicode filename.

The runtime image copies Node renderer/config/file helpers and registered master files. No new dependency,
Office/Python server, PDF renderer, signature provider or second storage service is introduced. PDF deferred.

## Privacy

These are **unsigned operational documents**, not signed legal retention facts. Student or associated
Contact physical cleanup immediately clears their generated input/evidence and revokes download;
existing leased worker then deletes all recorded artifact attempts and marks ERASED. Financial Contract,
Payment/Refund and Agreement/Commission retention remains under existing policy. Cleanup cannot erase
those ledgers. Channel associated Contact cleanup likewise erases operational documents, retains Agreement.

Privacy subject scope includes participant, linked Household members/Guardian relationships, or associated
Organization Contacts. These references support conservative erasure, never prove buyer/Guardian/signatory
capacity. Names explicitly entered without a CRM Contact relationship cannot be safely identity-matched;
privacy staff must review source documents for such external parties. Do not infer identity from name alone.
A future signed legal archive needs its own approved retention policy; this phase creates no signed archive.

Verified, currently leased privacy export jobs may export document lineage and only the requester's own
mapped Student Contact identity evidence. Other parties' bank/Guardian/signature confirmation values and
whole DOCX files are not embedded in a general Contact export. Source-authorized document retrieval is separate.
This avoids exporting another person's PII merely because a household is shared.

## Static configuration / approval operations

`/api/contract-document-governance` GET returns governance metadata only. POST supports `registerCatalog`,
`saveConfiguration`, `templateStatus`, `configurationStatus`; exact allowed fields are checked against catalog.
Creator cannot approve their own version. Status change is a separate governance fact, not CONTRACT_SIGN,
Contract approval or Agreement activation. Retirement retains approved version lineage.

Static values are AES-256-GCM encrypted with purpose-specific AAD using
`DOCUMENT_CONFIGURATION_ENCRYPTION_KEY` (32-byte base64 / 64 hex). It must be protected outside Git and
identical in web/worker; optional runtime preflight checks presence on both sides, valid encoding, agreement
and independence from invitation encryption when configured. This secret encrypts config; it supplies
**no legal name or other contract content**. Rotation requires re-encrypting historic configuration versions.
Missing key/config fails closed for production generation. Real production configuration was not created.

## API / UI / mutation boundary

`GET /api/contract-documents` returns source-authorized options, templates and history. POST `validate`,
`preview`, `generate` requires contracts.manage. Preview is clearly PREVIEW-only and persists no lineage,
job or business mutation; validate returns read-only/masked review fields plus missing/unsupported issues.
Generation returns queued document ID. `/api/contract-documents/[id]/download` reauthorizes per request.
Customer Documents live in existing Contracts workspace; Channel Documents live beside their Agreement
version, guarded by Channel money access. Production selector contains only active APPROVED versions;
admin DRAFT preview is an explicit separate mode. Sensitive confirmations are masked; canonical values
are read-only. Unknown outcome preserves the request and locks inputs until same-payload retry; conflict
asks for refresh/review. History shows template/source/document versions and artifact hash, never Signed.
All affected labels/messages are zh-CN/en and the section is responsive at 1440/375.

## Phase 2 frozen boundaries

Template ≠ Contract ≠ Channel Agreement. Template Version ≠ Contract Version ≠ Document Version.
Generated Document ≠ Signed Document ≠ Approved Contract ≠ Payment ≠ Revenue ≠ Commission Accrual.
Generation/download ≠ status change, signature or approval. Preview ≠ production generation.
Canonical Fact ≠ user-confirmed document value; user confirmation ≠ canonical override.
Generation evidence ≠ editable business fact. AI inference ≠ business fact.
No Upload extraction, OCR/LLM, e-signature, automatic status/payment/refund/commission, Revenue,
Data Import Upgrade, Targets/Forecast or Management AI.

## Phase 3 — Uploaded Evidence Contract

External uploads have a separate identity in `uploaded_contract_documents`, never a generated-document
row, Contract Version or signature. Migration 110 is necessary: the existing contract_documents parent is
customer-only, and neither it nor the generation model records immutable external originals, extraction
runs and append-only human decisions. Migration 109 is unchanged. Sources are exactly CUSTOMER_CONTRACT
or CHANNEL_AGREEMENT_VERSION; staff must select the parent first. No entity is created or matched by name.

Each original stores workspace, parent/revision at upload, selected canonical context, filename, format,
MIME, byte length, SHA256, private key, uploader/time and revision. Original identity, hash and key cannot
be updated. A different file is new evidence, not a Contract Version. Exact source/SHA duplicates reuse
one identity; the same bytes under another parent are a separate lineage. Upload receipts are actor/workspace
scoped and payload-bound, serialize concurrent requests and reject key reuse with different input.

STORING is an internal, non-downloadable reservation. Only successful object storage followed by the
completion RPC enters UPLOADED and atomically enqueues extraction. A tracked private reservation remains
retryable after an ambiguous result. Originals use create-only storage: atomic local link after a temporary
write, or conditional S3 PutObject. Same-byte retries are accepted; changed bytes fail closed. An upload
failure never deletes a concurrently successful original. Parser/worker reads never overwrite originals.

States are UPLOADED, EXTRACTING, EXTRACTED, EXTRACTION_FAILED, REVIEWED, ERASURE_PENDING and ERASED.
REVIEWED means all candidates in the latest run received a human decision; it is not legal approval.
No state is SIGNED, ACTIVE or APPROVED. Generated and Uploaded are distinct labels in the existing
Customer Contract and Channel Agreement Documents sections.

## Extraction Contract

The Node worker reuses generated_jobs with CONTRACT_DOCUMENT_EXTRACTION and a matching uploaded-document
origin. It has no direct upload/run/review table grants; input, completion, failure and erasure are scoped
to the current unexpired job lease and exact workspace/document. It rechecks current source visibility.
Storage reads verify recorded length/SHA before parsing. Errors do not remove the downloadable original.

DOCX and text PDF are supported. Files are limited to 8,000,000 bytes; multipart bodies to 8,200,000 bytes,
PDFs to 100 pages, text to 300,000 characters and chunks to 5,000. DOCX also uses the existing 32 MB expanded
ZIP / 1,000-entry bounds, CRC/path validation and XML checks. DOCM, malformed packages, external relations,
DOCTYPE/entities and unsupported MIME/extension/magic combinations are rejected. No external relation is fetched.

PDF.js (`pdfjs-dist` pinned at 6.4.299, Apache-2.0; [official project](https://github.com/mozilla/pdf.js))
reads text without rendering, OCR, external services or eval. No-text/image-only PDF returns
OCR_REQUIRED_NOT_SUPPORTED; protected PDF returns PDF_PASSWORD_UNSUPPORTED. Passwords are never accepted.
PDF parsing runs in a credential-free Node thread with fetch disabled, 128 MB old-generation limit and
12-second deadline. This adds no Python/Office/Tesseract/AI production runtime. Legal PDF output generation
remains deferred and is distinct from uploaded-PDF text extraction.

DOCX chunks retain actual part (document/header/footer), paragraph index and table/row/cell coordinates.
DOCX has no invented page number. PDF chunks retain real page and block. Raw text and normalized text are
derived evidence; neither is a canonical business fact. LABELS_V1 uses exact known labels, adjacent labeled table cells and deterministic
value patterns, tolerating moved paragraphs and split runs. It does not infer entities or interpret arbitrary
legal prose. Unlabeled clauses/continuations can remain missing or incomplete candidates; the excerpt and
extracted-text pane let staff inspect and explicitly edit a document-only value. EXACT means an exact label
match, not truth, legal completeness or confidence probability. Multiple different matches are AMBIGUOUS.

`contract_extraction_runs` records extractor version, run number, job, timestamps, chunks/candidates and
status/error. Completed raw results cannot be overwritten. Explicit new-run requests create a new run;
retrying a failed run reuses its job/run until successful. Current run/version without force is idempotent.

## Candidate / Normalization Contract

Candidates use the Phase 1 stable field keys and frozen typed registry, not caller-defined target fields.
Each stores raw and normalized value, type, exact excerpt and location/offsets, method, confidence/validation
state and confirmation target. Missing fields are explicit entries without fabricated excerpt/location.
Money uses decimal strings, validated grouping and integer/decimal operations; no floating point. RMB/人民币
normalizes to CNY and 美元 to USD while preserving raw values. Unambiguous year-first dates normalize to ISO;
01/02/2026 stays AMBIGUOUS, invalid calendar dates stay invalid. Whitespace/punctuation normalization does
not equate 张三 with ZHANG SAN or link organizations by name.

Comparison is server-side against current canonical values in the explicit source context. MATCH is not
automatic confirmation. CONFLICT does not permit overriding. Missing-in-CRM means no value was resolved
in that context; it is not proof that a related entity or approved static configuration does not exist.
Company/static and derived fields without a current source mapping cannot be authoritatively reconciled.
Explicit Enrollment selection is needed for participant/program/Cohort comparison; rule selection is needed
for commission comparison. No first Enrollment or first Commission Rule is guessed.

| Target | Fields / rule | Allowed human decision | Canonical mutation |
| --- | --- | --- | --- |
| CANONICAL_READ_ONLY | All CANONICAL, DERIVED and TEMPLATE_CONSTANT fields; company.*; student-template bank.* | Reject / defer only | None |
| DOCUMENT_ONLY | Remaining USER_CONFIRMED fields: buyer signing/notice, Guardian requirement/name/capacity, signing date, itinerary/payment terms, channel legal/signatory/contact/bank values and approved-contract field catalog entries | Confirm valid unambiguous value, edit explicit value, reject / defer | None |
| UNSUPPORTED | commission.eligibility_clause, commission.settlement_condition, review.party_capacity | Reject / defer; business/legal review stays unresolved | None |

The existing Phase 1 field tables specify each key/type/source/required rule. For every field, the target
above is computed from its category and source kind and tested against the complete typed SQL registry.
No CANONICAL_MUTATION_ALLOWED fields are implemented. Contract amount/currency, Student identity, Product,
Cohort, Agreement dates and Commission Rule amount/currency are comparison-only. Mentioned payment/refund,
commission, signing date/image or a filename containing signed never creates a financial fact, accrual or
signature transition. Bank/company configuration cannot be changed from review.

## Human Review / Canonical Conflict Contract

`contract_extraction_reviews` is append-only and stores candidate identity, raw-reference run, decision,
confirmed value, actor/time, reason, source revision and document revision. Raw extraction remains separate.
CONFIRMED requires the exact normalized, valid, unambiguous document-only value. EDITED validates type
and preserves both extracted and edited values; it can explicitly resolve an ambiguous date or fill a
missing document-only field. REJECTED / DEFERRED do not save a substitute value. Confirmation does not
approve legal clauses. Unsupported commission eligibility and student party-capacity review stay blockers.

Review requires source manage access, existing contracts.manage roles and AAL2, current document revision,
current source revision and a payload-bound request receipt. A stale source/reviewer returns a conflict.
Existing evidence remains after the parent changes; comparison refreshes current canonical values.
Each review is an atomic decision + minimal audit + document revision. No bulk canonical acceptance and
no Apply to CRM endpoint exist. Any future canonical update must independently use the owning domain's
authorized mutation, revision, transaction, audit and retry contract.

## Source Authorization / Privacy / Retention

All list/detail/upload/extract/review/download paths reauthorize current parent/workspace and selected
Enrollment/rule context. Channel access reuses Organization + commercial money permissions. Query IDs and
storage keys do not grant access. The database enforces parent workspace, job origin and review-run/document
relationships. Raw tables have RLS enabled and no application/worker direct grants. Every original download
is a source-authorized private proxy with recorded SHA/length verification; no permanent storage URL.

Sensitive candidates (participant/buyer/Guardian/bank/contact fields), ambiguous/invalid raw candidates and
all source excerpts are masked in the default response. Sensitive canonical identity fields and extracted
chunks are omitted. Privileged reveal requires existing manage access and AAL2. Lists never include whole
extraction JSON. Audit contains document/run/candidate identity, decision/status/count/hash, never filename,
full text, bank account, Guardian/confirmed value or excerpt.

Uploads are **unsigned operational evidence**, including a staff-claimed signed copy; there is no signed
legal archive policy in Phase 3. Known parent Household members, linked Enrollment Students/Guardians and
Organization-associated Contacts are tracked for conservative erasure, not as legal party assertions.
External people appearing only as text require privacy staff review; no identity is inferred from a name.
Verified leased privacy export includes source/document lineage only, never whole files or another party's
bank/Guardian data. A separate source-authorized download is not a general subject export.

Student/Contact physical cleanup immediately revokes download, clears text/candidates/reviews/receipts and
queues private-object erasure in the existing worker. A follow-up sweep after 60 seconds removes a late
in-flight write; it uses the same lease-scoped queue and bounded S3 upload timeout, not a second job system.
Contract/Finance/Agreement/Commission ledgers remain intact. Original hash/parent lineage can remain as
non-content erasure evidence; original filename and personal relationship snapshot are cleared.

## Phase 3 API / UI / Frozen Boundaries

`GET/POST /api/contract-document-uploads` lists source-scoped uploads or accepts a bounded multipart
file + explicit parent/revision/context/request input. `GET /[id]` returns masked current-run detail;
`GET /[id]/download` reauthorizes original retrieval. `POST /[id]/extract` retries or explicitly creates
a new run; `POST /[id]/review` records one typed revision-bound decision. Existing apiRoute authentication,
CSRF, capability checks and no-store policy apply. No /api/v324 or canonical Apply endpoint is introduced.

Uploaded Document ≠ Generated Document ≠ Contract Version ≠ Signed / Approved Contract.
Extracted Text / Candidate ≠ Business Fact. Candidate Confidence ≠ Truth.
Raw Candidate ≠ Confirmed Document Value ≠ Canonical Business Fact.
Human Confirmation ≠ Canonical Override Permission. Canonical Conflict ≠ Permission to Overwrite.
Signature Text / Claimed Signed Copy ≠ Verified Signature Fact. Mentioned Payment / Refund / Commission /
Enrollment / Revenue ≠ their canonical domain facts. Extraction ≠ AI; AI inference ≠ Business Fact.

No OCR/image extraction, LLM/AI, semantic entity matching, automatic parent/payment/refund/commission creation,
automatic SIGNED/ACTIVE, e-signature, Revenue, Data Import Upgrade, Targets/Forecast or Management AI.

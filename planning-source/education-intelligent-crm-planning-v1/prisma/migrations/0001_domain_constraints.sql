-- PostgreSQL domain constraints and indexes for Education Relationship CRM.
-- Apply this SQL by merging it into a Prisma create-only migration after
-- Prisma has created the referenced tables and enum types.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- unaccent(text) is not declared immutable by the extension and therefore
-- cannot be used directly in an expression index. This wrapper is safe for
-- a fixed unaccent dictionary in this application.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$;

-- ---------------------------------------------------------------------------
-- Numeric and range constraints
-- ---------------------------------------------------------------------------

ALTER TABLE organizations
  ADD CONSTRAINT organizations_relationship_health_score_ck
    CHECK ("relationshipHealthScore" IS NULL OR "relationshipHealthScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT organizations_data_completeness_score_ck
    CHECK ("dataCompletenessScore" IS NULL OR "dataCompletenessScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT organizations_counts_nonnegative_ck
    CHECK (
      ("studentCount" IS NULL OR "studentCount" >= 0) AND
      ("internationalStudentCount" IS NULL OR "internationalStudentCount" >= 0) AND
      ("graduationStudentCount" IS NULL OR "graduationStudentCount" >= 0)
    ),
  ADD CONSTRAINT organizations_established_year_ck
    CHECK ("establishedYear" IS NULL OR "establishedYear" BETWEEN 1000 AND 2200);

ALTER TABLE people
  ADD CONSTRAINT people_data_completeness_score_ck
    CHECK ("dataCompletenessScore" IS NULL OR "dataCompletenessScore" BETWEEN 0 AND 100);

ALTER TABLE parent_profiles
  ADD CONSTRAINT parent_profiles_observation_confidence_ck
    CHECK ("observationConfidence" IS NULL OR "observationConfidence" BETWEEN 0 AND 100);

ALTER TABLE households
  ADD CONSTRAINT households_budget_nonnegative_ck
    CHECK (
      ("budgetMin" IS NULL OR "budgetMin" >= 0) AND
      ("budgetMax" IS NULL OR "budgetMax" >= 0)
    ),
  ADD CONSTRAINT households_budget_order_ck
    CHECK ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax"),
  ADD CONSTRAINT households_lifetime_value_nonnegative_ck
    CHECK ("lifetimeValue" IS NULL OR "lifetimeValue" >= 0),
  ADD CONSTRAINT households_data_completeness_score_ck
    CHECK ("dataCompletenessScore" IS NULL OR "dataCompletenessScore" BETWEEN 0 AND 100);

ALTER TABLE student_profiles
  ADD CONSTRAINT student_profiles_application_year_ck
    CHECK ("applicationYear" IS NULL OR "applicationYear" BETWEEN 2000 AND 2200),
  ADD CONSTRAINT student_profiles_data_completeness_score_ck
    CHECK ("dataCompletenessScore" IS NULL OR "dataCompletenessScore" BETWEEN 0 AND 100);

ALTER TABLE academic_calendars
  ADD CONSTRAINT academic_calendars_months_ck
    CHECK (
      "yearStartMonth" BETWEEN 1 AND 12 AND
      "yearEndMonth" BETWEEN 1 AND 12 AND
      "promotionWindowStartMonth" BETWEEN 1 AND 12 AND
      "promotionEffectiveMonth" BETWEEN 1 AND 12
    ),
  ADD CONSTRAINT academic_calendars_days_ck
    CHECK (
      "yearStartDay" BETWEEN 1 AND 31 AND
      "yearEndDay" BETWEEN 1 AND 31 AND
      "promotionWindowStartDay" BETWEEN 1 AND 31 AND
      "promotionEffectiveDay" BETWEEN 1 AND 31
    ),
  ADD CONSTRAINT academic_calendars_version_ck
    CHECK (version >= 1);

ALTER TABLE grade_levels
  ADD CONSTRAINT grade_levels_sort_order_ck CHECK ("sortOrder" >= 0);

ALTER TABLE grade_progression_rules
  ADD CONSTRAINT grade_progression_rules_version_ck CHECK ("ruleVersion" >= 1),
  ADD CONSTRAINT grade_progression_rules_effective_month_ck
    CHECK ("effectiveMonth" IS NULL OR "effectiveMonth" BETWEEN 1 AND 12),
  ADD CONSTRAINT grade_progression_rules_effective_day_ck
    CHECK ("effectiveDay" IS NULL OR "effectiveDay" BETWEEN 1 AND 31),
  ADD CONSTRAINT grade_progression_rules_grade_change_ck
    CHECK (
      "transitionType"::text IN ('REPEAT_GRADE', 'GRADUATION', 'TRANSFER', 'MANUAL')
      OR "toGradeLevelId" IS DISTINCT FROM "fromGradeLevelId"
    );

ALTER TABLE student_academic_snapshots
  ADD CONSTRAINT student_academic_snapshots_gpa_ck
    CHECK (
      "gpa" IS NULL OR
      ("gpa" >= 0 AND ("gpaScale" IS NULL OR ("gpaScale" > 0 AND "gpa" <= "gpaScale")))
    ),
  ADD CONSTRAINT student_academic_snapshots_rank_ck
    CHECK (
      ("classRank" IS NULL OR "classRank" >= 1) AND
      ("cohortSize" IS NULL OR "cohortSize" >= 1) AND
      ("classRank" IS NULL OR "cohortSize" IS NULL OR "classRank" <= "cohortSize")
    );

ALTER TABLE student_subject_records
  ADD CONSTRAINT student_subject_records_score_ck
    CHECK (
      "score" IS NULL OR
      ("score" >= 0 AND ("scoreScale" IS NULL OR ("scoreScale" > 0 AND "score" <= "scoreScale")))
    );

ALTER TABLE student_assessment_attempts
  ADD CONSTRAINT student_assessment_attempts_score_ck
    CHECK (
      ("totalScore" IS NULL OR "totalScore" >= 0) AND
      ("targetScore" IS NULL OR "targetScore" >= 0) AND
      ("scoreScale" IS NULL OR "scoreScale" > 0) AND
      ("totalScore" IS NULL OR "scoreScale" IS NULL OR "totalScore" <= "scoreScale") AND
      ("targetScore" IS NULL OR "scoreScale" IS NULL OR "targetScore" <= "scoreScale")
    );

ALTER TABLE student_intents
  ADD CONSTRAINT student_intents_certainty_score_ck
    CHECK ("certaintyScore" IS NULL OR "certaintyScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT student_intents_application_year_ck
    CHECK ("applicationYear" IS NULL OR "applicationYear" BETWEEN 2000 AND 2200),
  ADD CONSTRAINT student_intents_budget_ck
    CHECK (
      ("budgetMin" IS NULL OR "budgetMin" >= 0) AND
      ("budgetMax" IS NULL OR "budgetMax" >= 0) AND
      ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax")
    ),
  ADD CONSTRAINT student_intents_validity_ck
    CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

ALTER TABLE student_target_preferences
  ADD CONSTRAINT student_target_preferences_priority_ck CHECK (priority >= 1);

ALTER TABLE pipeline_stages
  ADD CONSTRAINT pipeline_stages_probability_ck
    CHECK ("defaultProbability" BETWEEN 0 AND 100),
  ADD CONSTRAINT pipeline_stages_sort_order_ck CHECK ("sortOrder" >= 0),
  ADD CONSTRAINT pipeline_stages_closed_flags_ck
    CHECK (NOT ("isClosedWon" AND "isClosedLost"));

ALTER TABLE leads
  ADD CONSTRAINT leads_subject_required_ck
    CHECK (
      "organizationId" IS NOT NULL OR
      "personId" IS NOT NULL OR
      "householdId" IS NOT NULL OR
      "studentProfileId" IS NOT NULL
    ),
  ADD CONSTRAINT leads_score_ck CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  ADD CONSTRAINT leads_score_confidence_ck
    CHECK ("scoreConfidence" IS NULL OR "scoreConfidence" BETWEEN 0 AND 100);

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_subject_required_ck
    CHECK (
      "organizationId" IS NOT NULL OR
      "householdId" IS NOT NULL OR
      "studentProfileId" IS NOT NULL
    ),
  ADD CONSTRAINT opportunities_amount_ck CHECK (amount IS NULL OR amount >= 0),
  ADD CONSTRAINT opportunities_probability_ck CHECK (probability BETWEEN 0 AND 100);

ALTER TABLE opportunity_products
  ADD CONSTRAINT opportunity_products_quantity_ck CHECK (quantity > 0),
  ADD CONSTRAINT opportunity_products_prices_ck
    CHECK (
      ("unitPrice" IS NULL OR "unitPrice" >= 0) AND
      (discount IS NULL OR discount BETWEEN 0 AND 1) AND
      ("totalAmount" IS NULL OR "totalAmount" >= 0)
    );

ALTER TABLE contracts
  ADD CONSTRAINT contracts_subject_required_ck
    CHECK (
      "organizationId" IS NOT NULL OR
      "householdId" IS NOT NULL OR
      "studentProfileId" IS NOT NULL OR
      "opportunityId" IS NOT NULL
    ),
  ADD CONSTRAINT contracts_amount_ck CHECK (amount IS NULL OR amount >= 0),
  ADD CONSTRAINT contracts_dates_ck
    CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_ck
    CHECK (amount >= 0 AND ("paidAmount" IS NULL OR "paidAmount" >= 0)),
  ADD CONSTRAINT payments_paid_amount_ck
    CHECK ("paidAmount" IS NULL OR "paidAmount" <= amount),
  ADD CONSTRAINT payments_sequence_ck CHECK ("sequenceNumber" >= 1);

ALTER TABLE activities
  ADD CONSTRAINT activities_subject_required_ck
    CHECK (
      "organizationId" IS NOT NULL OR
      "personId" IS NOT NULL OR
      "householdId" IS NOT NULL OR
      "studentProfileId" IS NOT NULL OR
      "leadId" IS NOT NULL OR
      "opportunityId" IS NOT NULL
    ),
  ADD CONSTRAINT activities_duration_ck
    CHECK ("durationMinutes" IS NULL OR "durationMinutes" >= 0),
  ADD CONSTRAINT activities_next_action_ck
    CHECK (
      "requiresNextAction" OR
      NULLIF(BTRIM("nextActionWaivedReason"), '') IS NOT NULL
    );

ALTER TABLE documents
  ADD CONSTRAINT documents_size_ck CHECK ("sizeBytes" >= 0),
  ADD CONSTRAINT documents_version_ck CHECK (version >= 1);

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_counts_ck
    CHECK (
      "totalRows" >= 0 AND
      "processedRows" >= 0 AND
      "createdCount" >= 0 AND
      "updatedCount" >= 0 AND
      "mergedCount" >= 0 AND
      "skippedCount" >= 0 AND
      "errorCount" >= 0
    );

ALTER TABLE import_row_issues
  ADD CONSTRAINT import_row_issues_row_number_ck CHECK ("rowNumber" >= 1);

ALTER TABLE import_entity_results
  ADD CONSTRAINT import_entity_results_row_number_ck CHECK ("rowNumber" >= 1);

ALTER TABLE report_jobs
  ADD CONSTRAINT report_jobs_download_count_ck CHECK ("downloadCount" >= 0);

ALTER TABLE ai_models
  ADD CONSTRAINT ai_models_costs_ck
    CHECK (
      ("inputCostPerMillion" IS NULL OR "inputCostPerMillion" >= 0) AND
      ("outputCostPerMillion" IS NULL OR "outputCostPerMillion" >= 0)
    );

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_confidence_ck CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  ADD CONSTRAINT ai_runs_token_cost_latency_ck
    CHECK (
      ("inputTokens" IS NULL OR "inputTokens" >= 0) AND
      ("outputTokens" IS NULL OR "outputTokens" >= 0) AND
      (cost IS NULL OR cost >= 0) AND
      ("latencyMs" IS NULL OR "latencyMs" >= 0)
    );

-- ---------------------------------------------------------------------------
-- Date consistency constraints
-- ---------------------------------------------------------------------------

ALTER TABLE staff_assignments
  ADD CONSTRAINT staff_assignments_dates_ck
    CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE person_relationships
  ADD CONSTRAINT person_relationships_people_different_ck CHECK ("fromPersonId" <> "toPersonId"),
  ADD CONSTRAINT person_relationships_dates_ck
    CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE household_members
  ADD CONSTRAINT household_members_dates_ck
    CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE student_guardian_relationships
  ADD CONSTRAINT student_guardian_relationships_dates_ck
    CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE student_enrollments
  ADD CONSTRAINT student_enrollments_dates_ck
    CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE student_experiences
  ADD CONSTRAINT student_experiences_dates_ck
    CHECK ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");

-- ---------------------------------------------------------------------------
-- Partial uniqueness constraints
-- ---------------------------------------------------------------------------

-- A person may have multiple contact values of the same type, but only one
-- active primary value per type.
CREATE UNIQUE INDEX person_contact_methods_one_primary_per_type_uq
  ON person_contact_methods ("personId", type)
  WHERE "isPrimary" = TRUE AND "deletedAt" IS NULL;

-- Only one current intent version per student.
CREATE UNIQUE INDEX student_intents_one_current_uq
  ON student_intents ("studentProfileId")
  WHERE "isCurrent" = TRUE;

-- A workspace has at most one active default pipeline for each type.
CREATE UNIQUE INDEX pipelines_one_active_default_per_type_uq
  ON pipelines ("workspaceId", type)
  WHERE "isDefault" = TRUE AND "isActive" = TRUE;

-- A school/workspace context has at most one active default academic calendar.
CREATE UNIQUE INDEX academic_calendars_one_default_per_context_uq
  ON academic_calendars ("workspaceId", COALESCE("organizationId", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "isDefault" = TRUE AND "isActive" = TRUE;

-- A current household membership should not be duplicated for the same person.
CREATE UNIQUE INDEX household_members_current_role_uq
  ON household_members ("householdId", "personId", role)
  WHERE "endDate" IS NULL;

-- Prevent duplicate active staff assignments with the exact same scope/title.
CREATE UNIQUE INDEX staff_assignments_current_identity_uq
  ON staff_assignments (
    "personId",
    "organizationId",
    COALESCE("organizationUnitId", '00000000-0000-0000-0000-000000000000'::uuid),
    LOWER(BTRIM("rawTitle"))
  )
  WHERE "employmentStatus" = 'CURRENT' AND "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Search and deduplication indexes
-- ---------------------------------------------------------------------------

CREATE INDEX organizations_display_name_trgm_idx
  ON organizations USING gin (LOWER(immutable_unaccent("displayName")) gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX organizations_english_name_trgm_idx
  ON organizations USING gin (LOWER(immutable_unaccent("englishName")) gin_trgm_ops)
  WHERE "englishName" IS NOT NULL AND "deletedAt" IS NULL;

CREATE INDEX organizations_normalized_name_trgm_idx
  ON organizations USING gin ("normalizedName" gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX people_display_name_trgm_idx
  ON people USING gin (LOWER(immutable_unaccent("displayName")) gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX people_chinese_name_trgm_idx
  ON people USING gin ("chineseName" gin_trgm_ops)
  WHERE "chineseName" IS NOT NULL AND "deletedAt" IS NULL;

CREATE INDEX people_english_name_trgm_idx
  ON people USING gin (LOWER(immutable_unaccent("englishName")) gin_trgm_ops)
  WHERE "englishName" IS NOT NULL AND "deletedAt" IS NULL;

CREATE INDEX people_normalized_name_trgm_idx
  ON people USING gin ("normalizedName" gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX person_contact_methods_normalized_value_trgm_idx
  ON person_contact_methods USING gin ("normalizedValue" gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX households_name_trgm_idx
  ON households USING gin (LOWER(immutable_unaccent(name)) gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

-- Common active-record indexes supplementing Prisma indexes.
CREATE INDEX staff_assignments_active_by_org_idx
  ON staff_assignments ("workspaceId", "organizationId", "decisionRole", "influenceLevel")
  WHERE "employmentStatus" = 'CURRENT' AND "deletedAt" IS NULL;

CREATE INDEX student_enrollments_current_by_school_idx
  ON student_enrollments ("workspaceId", "organizationId", "curriculumId", "gradeLevelId")
  WHERE "isCurrent" = TRUE AND "deletedAt" IS NULL;

CREATE INDEX opportunities_open_pipeline_idx
  ON opportunities ("workspaceId", "pipelineId", "stageId", "ownerMembershipId", "expectedCloseDate")
  WHERE status = 'OPEN' AND "deletedAt" IS NULL;

CREATE INDEX tasks_open_due_idx
  ON tasks ("workspaceId", "assigneeMembershipId", "dueAt", priority)
  WHERE status IN ('TODO', 'IN_PROGRESS', 'WAITING') AND "deletedAt" IS NULL;

CREATE INDEX progression_events_pending_idx
  ON student_progression_events ("workspaceId", "effectiveDate", status)
  WHERE status IN ('DISCOVERED', 'PENDING_REVIEW', 'APPROVED', 'SCHEDULED', 'FAILED');

CREATE INDEX data_quality_issues_open_idx
  ON data_quality_issues ("workspaceId", severity, "assigneeMembershipId", "detectedAt")
  WHERE status IN ('OPEN', 'ACKNOWLEDGED');

-- ---------------------------------------------------------------------------
-- Optional RLS template
-- ---------------------------------------------------------------------------
-- Do not enable without a verified application strategy for setting
-- app.current_workspace_id on every web request, Temporal worker, report job,
-- import job, and admin connection.
--
-- ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY organizations_workspace_policy ON organizations
--   USING ("workspaceId" = current_setting('app.current_workspace_id')::uuid)
--   WITH CHECK ("workspaceId" = current_setting('app.current_workspace_id')::uuid);

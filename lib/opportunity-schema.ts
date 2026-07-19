import { z } from "zod";

export const opportunityStages = [
  "DISCOVERY",
  "EVALUATION",
  "HESITATION",
  "PAYMENT",
  "WON",
  "LOST",
] as const;

export type OpportunityStage = (typeof opportunityStages)[number];

export const activeOpportunityStages = opportunityStages.slice(0, 4) as [
  "DISCOVERY",
  "EVALUATION",
  "HESITATION",
  "PAYMENT",
];

export const opportunityStageProbability: Record<OpportunityStage, number> = {
  DISCOVERY: 20,
  EVALUATION: 40,
  HESITATION: 60,
  PAYMENT: 85,
  WON: 100,
  LOST: 0,
};

const nextActionFields = {
  expectedCloseDate: z.string().date(),
  nextActionZh: z.string().trim().min(1).max(300),
  nextActionEn: z.string().trim().min(1).max(300),
};

export const createOpportunitySchema = z.object({
  subjectType: z.enum(["SCHOOL", "HOUSEHOLD"]),
  organizationId: z.string().uuid().nullable().optional(),
  householdId: z.string().uuid().nullable().optional(),
  productId: z.string().uuid().nullable().optional(),
  titleZh: z.string().trim().min(1).max(160),
  titleEn: z.string().trim().min(1).max(180),
  stage: z.enum(activeOpportunityStages),
  amount: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  probability: z.number().int().min(0).max(100),
  ...nextActionFields,
}).superRefine((value, context) => {
  if (value.subjectType === "SCHOOL" && (!value.organizationId || value.householdId)) {
    context.addIssue({ code: "custom", message: "SCHOOL_SUBJECT_REQUIRED", path: ["organizationId"] });
  }
  if (value.subjectType === "HOUSEHOLD" && (!value.householdId || value.organizationId)) {
    context.addIssue({ code: "custom", message: "HOUSEHOLD_SUBJECT_REQUIRED", path: ["householdId"] });
  }
});

export const transitionOpportunitySchema = z.object({
  stage: z.enum(opportunityStages),
  probability: z.number().int().min(0).max(100),
  expectedCloseDate: z.string().date().nullable().optional(),
  nextActionZh: z.string().trim().max(300).default(""),
  nextActionEn: z.string().trim().max(300).default(""),
  reason: z.string().trim().max(500).optional(),
  evidence: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  if (
    value.stage !== "WON"
    && value.stage !== "LOST"
    && (!value.expectedCloseDate || !value.nextActionZh || !value.nextActionEn)
  ) {
    context.addIssue({
      code: "custom",
      message: "NEXT_ACTION_REQUIRED",
      path: ["nextActionZh"],
    });
  }
  if (value.stage === "WON" && !value.evidence) {
    context.addIssue({
      code: "custom",
      message: "WON_EVIDENCE_REQUIRED",
      path: ["evidence"],
    });
  }
  if (value.stage === "LOST" && !value.reason) {
    context.addIssue({
      code: "custom",
      message: "LOST_REASON_REQUIRED",
      path: ["reason"],
    });
  }
});

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;
export type TransitionOpportunityInput = z.infer<typeof transitionOpportunitySchema>;

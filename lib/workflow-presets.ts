import type { WorkflowTemplateData } from "./workflow-input";

export const workflowPresets = [
  { key: "application", nameZh: "院校申请", nameEn: "Institution application", steps: [
    ["确认申请目标与要求", "Confirm application goals and requirements"],
    ["收集并核对申请材料", "Collect and review application documents"],
    ["提交申请并记录回执", "Submit application and record acknowledgement"],
    ["跟进面试与录取决定", "Follow up interview and admission decision"],
    ["确认入学安排", "Confirm enrollment arrangements"],
  ] },
  { key: "program", nameZh: "课程／项目报名", nameEn: "Course / program enrollment", steps: [
    ["确认课程需求与报名资格", "Confirm program needs and eligibility"],
    ["确认项目、批次与报名材料", "Confirm program, cohort and documents"],
    ["完成报名审核", "Review enrollment application"],
    ["确认开课与参与安排", "Confirm start and participation arrangements"],
  ] },
] as const;

/** Presets create editable drafts, never activate a workflow or infer completion. */
export function workflowPresetData(key: string): WorkflowTemplateData {
  const preset = workflowPresets.find(item => item.key === key);
  if (!preset) throw new Error("WORKFLOW_INPUT_INVALID");
  return { name_zh: preset.nameZh, name_en: preset.nameEn, product_id: null, workflow_type: "ADMISSIONS", description: "", steps: preset.steps.map(([zh, en], index) => ({
    id: crypto.randomUUID(), sequence: (index + 1) * 10, name_zh: zh, name_en: en,
    required: true, default_owner_role: null, offset_basis: null, offset_days: null,
    step_kind: "TASK", task_config: { title_zh: zh, title_en: en, description: "", priority: "NORMAL" }, milestone_config: null, checkpoint_config: null,
  })) };
}

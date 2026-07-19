import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parsePagination, parseUuid, requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import {
  applyProgression,
  addStudentAcademicRecord,
  cancelProgression,
  createHousehold,
  createStudent,
  getHouseholdDetail,
  getProgressionBatchDetail,
  getStudentDetail,
  listHouseholds,
  listProgressionBatches,
  listProgressionRules,
  listStudents,
  previewProgression,
  removeHouseholdMember,
  removeStudentGuardian,
  saveHouseholdMember,
  saveProgressionRule,
  saveStudentGuardian,
  updateHousehold,
  updateProgressionItem,
  updateStudent,
} from "@/lib/v200-repository";

const schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("createHousehold"), nameZh: z.string().trim().min(1).max(120), nameEn: z.string().trim().min(1).max(160), address: z.string().trim().max(500).default("") }),
  z.object({ operation: z.literal("createStudent"), personId: z.uuid(), householdId: z.uuid().nullable().optional(), studentNumber: z.string().trim().max(60).optional(), grade: z.string().trim().min(1).max(40), academicYear: z.string().trim().min(4).max(20) }),
  z.object({ operation: z.literal("updateStudent"), id: z.uuid(), expectedUpdatedAt: z.iso.datetime(), householdId: z.uuid().nullable().optional(), grade: z.string().trim().min(1).max(40), academicYear: z.string().trim().min(4).max(20), status: z.enum(["ACTIVE","ON_LEAVE","ALUMNI","WITHDRAWN","ARCHIVED"]) }),
  z.object({ operation: z.literal("updateHousehold"), id: z.uuid(), expectedUpdatedAt: z.iso.datetime(), nameZh: z.string().trim().min(1).max(120), nameEn: z.string().trim().min(1).max(160), address: z.string().trim().max(500), status: z.enum(["ACTIVE","INACTIVE","ARCHIVED"]) }),
  z.object({ operation: z.literal("addAcademic"), studentId: z.uuid(), schoolId: z.uuid().nullable().optional(), curriculum: z.string().trim().min(1).max(120), grade: z.string().trim().min(1).max(40), academicYear: z.string().trim().min(4).max(20), validFrom: z.iso.date(), validTo: z.iso.date().nullable().optional(), status: z.enum(["CURRENT","COMPLETED","PLANNED"]) }).refine((value) => !value.validTo || value.validTo >= value.validFrom, { path: ["validTo"] }),
  z.object({ operation: z.literal("previewProgression"), fromYear: z.string().trim().min(4).max(20), toYear: z.string().trim().min(4).max(20), requestKey: z.string().trim().min(8).max(160) }),
  z.object({ operation: z.literal("applyProgression"), id: z.uuid(), requestKey: z.string().trim().min(8).max(160) }),
  z.object({ operation: z.literal("updateProgressionItem"), id: z.uuid(), selected: z.boolean(), toGrade: z.string().trim().min(1).max(40), action: z.enum(["ADVANCE","GRADUATE","HOLD"]), reason: z.string().trim().max(500).default("") }),
  z.object({ operation: z.literal("cancelProgression"), id: z.uuid() }),
  z.object({ operation: z.literal("saveProgressionRule"), id: z.uuid().nullable().optional(), fromGrade: z.string().trim().min(1).max(40), toGrade: z.string().trim().min(1).max(40), action: z.enum(["ADVANCE","GRADUATE"]), active: z.boolean().default(true) }),
  z.object({ operation: z.literal("saveHouseholdMember"), householdId: z.uuid(), contactId: z.uuid(), role: z.enum(["PARENT","GUARDIAN","STUDENT","PAYER","OTHER"]), primary: z.boolean().default(false) }),
  z.object({ operation: z.literal("removeHouseholdMember"), id: z.uuid() }),
  z.object({ operation: z.literal("saveStudentGuardian"), studentId: z.uuid(), contactId: z.uuid(), relationship: z.enum(["MOTHER","FATHER","GUARDIAN","RELATIVE","OTHER"]), primary: z.boolean().default(false), emergency: z.boolean().default(false), legalAuthority: z.boolean().default(false) }),
  z.object({ operation: z.literal("removeStudentGuardian"), id: z.uuid() }),
]);

async function get(request: Request) {
  await requireApiCapability("education.view");
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "students";
  const id = url.searchParams.get("id");
  if (resource === "studentDetail") {
    const item = await getStudentDetail(parseUuid(id ?? "", "id"));
    if (!item) throw new ApiError("STUDENT_NOT_FOUND", 404);
    return NextResponse.json({ item });
  }
  if (resource === "householdDetail") {
    const item = await getHouseholdDetail(parseUuid(id ?? "", "id"));
    if (!item) throw new ApiError("HOUSEHOLD_NOT_FOUND", 404);
    return NextResponse.json({ item });
  }
  if (resource === "progressionDetail") {
    await requireApiCapability("progression.manage");
    const item = await getProgressionBatchDetail(parseUuid(id ?? "", "id"));
    if (!item) throw new ApiError("PROGRESSION_NOT_FOUND", 404);
    return NextResponse.json(item);
  }
  if (resource === "progressionRules") {
    await requireApiCapability("progression.manage");
    return NextResponse.json({ items: await listProgressionRules() });
  }
  const page = parsePagination(url.searchParams, 20);
  const options = { ...page, query: url.searchParams.get("q") ?? "", status: url.searchParams.get("status") ?? "all" };
  if (resource === "students") return NextResponse.json(await listStudents(options));
  if (resource === "households") return NextResponse.json(await listHouseholds(options));
  if (resource === "progression") {
    await requireApiCapability("progression.manage");
    return NextResponse.json(await listProgressionBatches(page));
  }
  throw new ApiError("UNKNOWN_EDUCATION_RESOURCE", 404);
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_EDUCATION_INPUT", 400, "INVALID_EDUCATION_INPUT", { field: String(parsed.error.issues[0]?.path[0] ?? "form") });
  if (parsed.data.operation === "createHousehold") {
    await requireApiCapability("education.manage");
    return NextResponse.json({ item: await createHousehold(parsed.data) }, { status: 201 });
  }
  if (parsed.data.operation === "createStudent") {
    await requireApiCapability("education.manage");
    return NextResponse.json({ item: await createStudent(parsed.data) }, { status: 201 });
  }
  if (parsed.data.operation === "updateStudent") {
    await requireApiCapability("education.manage");
    return NextResponse.json({ item: await updateStudent(parsed.data) });
  }
  if (parsed.data.operation === "updateHousehold") {
    await requireApiCapability("education.manage");
    return NextResponse.json({ item: await updateHousehold(parsed.data) });
  }
  if (parsed.data.operation === "addAcademic") {
    await requireApiCapability("education.manage");
    return NextResponse.json({ item: await addStudentAcademicRecord(parsed.data) }, { status: 201 });
  }
  if (parsed.data.operation === "saveHouseholdMember") {
    await requireApiCapability("education.manage");
    return NextResponse.json({ item: await saveHouseholdMember(parsed.data) });
  }
  if (parsed.data.operation === "removeHouseholdMember") {
    await requireApiCapability("education.manage");
    await removeHouseholdMember(parsed.data.id);
    return new NextResponse(null, { status: 204 });
  }
  if (parsed.data.operation === "saveStudentGuardian") {
    await requireApiCapability("education.manage");
    return NextResponse.json({ item: await saveStudentGuardian(parsed.data) });
  }
  if (parsed.data.operation === "removeStudentGuardian") {
    await requireApiCapability("education.manage");
    await removeStudentGuardian(parsed.data.id);
    return new NextResponse(null, { status: 204 });
  }
  await requireApiCapability("progression.manage");
  const item = parsed.data.operation === "previewProgression"
    ? await previewProgression(parsed.data.fromYear, parsed.data.toYear, parsed.data.requestKey)
    : parsed.data.operation === "applyProgression"
      ? await applyProgression(parsed.data.id, parsed.data.requestKey)
      : parsed.data.operation === "updateProgressionItem"
        ? await updateProgressionItem(parsed.data)
        : parsed.data.operation === "cancelProgression"
          ? await cancelProgression(parsed.data.id)
          : await saveProgressionRule(parsed.data);
  return NextResponse.json({ item });
}

export const GET = apiRoute(get, "EDUCATION_LOAD_FAILED");
export const POST = apiRoute(post, "EDUCATION_OPERATION_FAILED");

import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parsePagination, parseUuid, requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import {
  applyProgression,
  addStudentAcademicRecord,
  createHousehold,
  createStudent,
  getHouseholdDetail,
  getStudentDetail,
  listHouseholds,
  listProgressionBatches,
  listStudents,
  previewProgression,
  updateHousehold,
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
  await requireApiCapability("progression.manage");
  const item = parsed.data.operation === "previewProgression"
    ? await previewProgression(parsed.data.fromYear, parsed.data.toYear, parsed.data.requestKey)
    : await applyProgression(parsed.data.id, parsed.data.requestKey);
  return NextResponse.json({ item });
}

export const GET = apiRoute(get, "EDUCATION_LOAD_FAILED");
export const POST = apiRoute(post, "EDUCATION_OPERATION_FAILED");

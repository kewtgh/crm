import {z} from "zod";
export const contractEnrollmentMutationSchema=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("link"),id:z.uuid(),enrollmentId:z.uuid(),requestKey:z.string().min(8).max(160)}).strict(),
  z.object({operation:z.literal("unlink"),id:z.uuid(),expectedRevision:z.number().int().positive(),reason:z.string().trim().min(1).max(1000),requestKey:z.string().min(8).max(160)}).strict(),
]);
export type ContractEnrollmentMutation= z.infer<typeof contractEnrollmentMutationSchema>;

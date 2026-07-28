import { databaseJson } from "./db/gateway";

export type RelationshipHealth = {
  hasData: boolean;
  score: number | null;
  weeklyDelta: number | null;
  sampleSize: number;
  basis: "RELATIONSHIP_MILESTONES";
};

export const emptyRelationshipHealth: RelationshipHealth = {
  hasData: false,
  score: null,
  weeklyDelta: null,
  sampleSize: 0,
  basis: "RELATIONSHIP_MILESTONES",
};

export async function loadWorkspaceRelationshipHealth() {
  return databaseJson<RelationshipHealth>("/db/rpc/workspace_relationship_health", {
    method: "POST",
    body: "{}",
  });
}

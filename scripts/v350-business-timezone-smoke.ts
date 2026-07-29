import assert from "node:assert/strict";

import { withDatabaseContext } from "../lib/db/context";
import { closeDatabasePools, poolQuery } from "../lib/db/pools";
import type { AppRole } from "../lib/roles";
import { closeWorkerDatabase, workerJson } from "./lib/worker-database.mjs";

type WorkspaceSeed = {
  user_id: string;
  workspace_id: string;
  role: AppRole;
  business_timezone: string;
};

const seedResult = await poolQuery<WorkspaceSeed>(
  "system",
  `select
     membership.user_id,
     membership.workspace_id,
     membership.role,
     workspace.business_timezone
   from public.workspace_memberships membership
   join public.workspaces workspace on workspace.id = membership.workspace_id
   where membership.status = 'ACTIVE'
   order by membership.created_at
   limit 1`,
);
const seed = seedResult.rows[0];
assert.ok(seed, "an active workspace membership is required");

try {
  const userResult = await withDatabaseContext(
    {
      kind: "user",
      authorization: {
        userId: seed.user_id,
        workspaceId: seed.workspace_id,
        role: seed.role,
        aal: "aal2",
      },
    },
    (client) => client.query<{
      timezone: string;
      business_date: string;
      expected_date: string;
    }>(
      `select
         current_setting('TimeZone') as timezone,
         public.current_business_date()::text as business_date,
         (now() at time zone $1)::date::text as expected_date`,
      [seed.business_timezone],
    ),
  );
  const userRow = userResult.rows[0];
  assert.equal(userRow.timezone, seed.business_timezone);
  assert.equal(userRow.business_date, userRow.expected_date);

  const workerDate = await workerJson("/db/rpc/current_business_date", {
    method: "POST",
    body: "{}",
    workspaceId: seed.workspace_id,
  });
  assert.equal(workerDate, userRow.business_date);

  console.log(JSON.stringify({
    workspaceId: seed.workspace_id,
    timezone: seed.business_timezone,
    businessDate: userRow.business_date,
    userTransaction: "pass",
    workerTransaction: "pass",
  }));
} finally {
  await Promise.all([
    closeDatabasePools(),
    closeWorkerDatabase(),
  ]);
}

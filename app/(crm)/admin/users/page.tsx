import { DataLoadError } from "@/components/data-state";
import { RoleHierarchyNote } from "@/components/governance-pages";
import { StaffUsersPage } from "@/components/staff-users-page";
import { listStaffUsers } from "@/lib/admin-users-repository";

export default async function Page() {
  const result = await listStaffUsers({ page: 1, pageSize: 10 }).catch(() => null);
  return result ? <><RoleHierarchyNote/><StaffUsersPage initialItems={result.items} initialTotal={result.total}/></> : <DataLoadError detailKey="admin.users.loadFailed"/>;
}

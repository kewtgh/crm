import type { AppRole } from "./roles";

export type AppUser = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  displayNameZh: string;
  role: AppRole;
  initials: string;
};

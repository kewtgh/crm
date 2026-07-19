"use client";

import { createContext, useContext } from "react";
import { hasCapability, type Capability } from "@/lib/capabilities";
import type { AppUser } from "@/lib/user";

const AppUserContext = createContext<AppUser | null>(null);

export function AppUserProvider({ user, children }: { user: AppUser; children: React.ReactNode }) {
  return <AppUserContext.Provider value={user}>{children}</AppUserContext.Provider>;
}

export function useAppUser() {
  const user = useContext(AppUserContext);
  if (!user) throw new Error("useAppUser must be used inside AppUserProvider");
  return user;
}

export function useCapability(capability: Capability) {
  return hasCapability(useAppUser().role, capability);
}

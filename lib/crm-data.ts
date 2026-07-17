export type StatusTone = "green" | "amber" | "red" | "blue" | "gray" | "purple";

export type DataRow = {
  id: string;
  href?: string;
  primary: string;
  primaryEn?: string;
  bilingualName?: boolean;
  secondary: string;
  secondaryEn?: string;
  owner: string;
  status: string;
  statusKey?: string;
  statusTone: StatusTone;
  meta: string;
  extra: string;
  completeness: number;
};

export type ModuleConfig = {
  key: string;
  eyebrow: string;
  title: string;
  description: string;
  singular: string;
  primaryColumn: string;
  secondaryColumn: string;
  metaColumn: string;
  extraColumn: string;
  addLabel: string;
  searchPlaceholder: string;
  rows: DataRow[];
};

function persistentModule(key: string): ModuleConfig {
  return {
    key,
    eyebrow: "",
    title: "",
    description: "",
    singular: "",
    primaryColumn: "",
    secondaryColumn: "",
    metaColumn: "",
    extraColumn: "",
    addLabel: "",
    searchPlaceholder: "",
    rows: [],
  };
}

// Labels live in the locale dictionaries and rows always come from Supabase.
// Keeping data out of this configuration prevents acceptance fixtures from
// silently reappearing when a database request fails.
export const moduleConfigs: Record<"schools" | "people" | "tasks", ModuleConfig> = {
  schools: persistentModule("schools"),
  people: persistentModule("people"),
  tasks: persistentModule("tasks"),
};

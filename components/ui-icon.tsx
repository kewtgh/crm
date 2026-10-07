import { Activity, BookOpen, Building2, CalendarDays, ChartNoAxesColumn, CircleAlert, CircleDollarSign, FileText, GraduationCap, HeartPulse, House, Layers, ListTodo, MapPin, Network, Package, ShieldCheck, Target, Upload, UserRound, Users, Zap } from "lucide-react";

/** Decorative semantic vocabulary. Labels and business state remain supplied by the owner. */
export const uiIcons = {
  section: Layers, organization: Building2, person: UserRound, people: Users,
  student: GraduationCap, family: House, program: BookOpen, application: FileText,
  support: HeartPulse, activity: Activity, metric: ChartNoAxesColumn,
  attention: CircleAlert, finance: CircleDollarSign, governance: ShieldCheck,
  channel: Network, product: Package, opportunity: Target, queue: ListTodo,
  calendar: CalendarDays, import: Upload, action: Zap, location: MapPin,
} as const;
export type UiIconName = keyof typeof uiIcons;
export function UiIcon({ name, size=18, tone="context" }: { name:UiIconName; size?:16|18|20|24|30; tone?:"context"|"operational"|"finance"|"governance" }) {
  const Icon=uiIcons[name];
  return <Icon aria-hidden="true" focusable="false" size={size} strokeWidth={1.8} className={`ux-icon ux-icon-${tone}`} data-icon={name}/>;
}

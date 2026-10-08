import { Archive, Copy, Download, GitBranch, Sparkles, Pencil, Plus, MessageCircle, Handshake, Lightbulb, History, Settings2, ArrowUpRight, Activity, BookOpen, Building2, CalendarDays, ChartNoAxesColumn, CircleAlert, CircleDollarSign, FileText, GraduationCap, HeartPulse, House, Layers, ListTodo, MapPin, Network, Package, ShieldCheck, Target, Upload, UserRound, Users, Zap } from "lucide-react";

/** Shared semantic icon vocabulary for workspace headers, record facts and actions.
 * Use names by meaning, not by SVG shape; keep text labels on actions.
 * Icons are decorative (hidden from assistive technology), never a permission/state signal.
 * 16px actions, 18–20px sections, 24px summaries; use the existing tone tokens.
 * Extend this registry for new concepts instead of adding emoji or local SVG copies.
 */
export const uiIcons = {
  archive: Archive, copy: Copy, export: Download, workflow: GitBranch, automation: Sparkles, edit: Pencil, add: Plus, message: MessageCircle, partnership: Handshake, potential: Lightbulb, history: History, settings: Settings2, open: ArrowUpRight,
  section: Layers, organization: Building2, person: UserRound, people: Users,
  student: GraduationCap, family: House, program: BookOpen, application: FileText,
  target: Target, outcome: GraduationCap, support: HeartPulse, activity: Activity, metric: ChartNoAxesColumn,
  attention: CircleAlert, finance: CircleDollarSign, governance: ShieldCheck,
  channel: Network, product: Package, opportunity: Target, queue: ListTodo,
  calendar: CalendarDays, import: Upload, action: Zap, location: MapPin,
} as const;
export type UiIconName = keyof typeof uiIcons;
export function UiIcon({ name, size=18, tone="context" }: { name:UiIconName; size?:16|18|20|24|30; tone?:"context"|"operational"|"finance"|"governance" }) {
  const Icon=uiIcons[name];
  return <Icon aria-hidden="true" focusable="false" size={size} strokeWidth={1.8} className={`ux-icon ux-icon-${tone}`} data-icon={name}/>;
}

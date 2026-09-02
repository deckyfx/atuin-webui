import React from "react";
import {
  LayoutDashboard,
  Terminal,
  Scissors,
  ScrollText,
  Users,
  KeyRound,
  Activity,
  Keyboard,
  Stethoscope,
} from "lucide-react";
import { useRouteStore } from "../stores/route-store";
import type { Section } from "../stores/route-store";

interface NavItem {
  id: Section;
  label: string;
  icon: typeof Terminal;
  /** Default sub-route, so the address bar always shows a full path. */
  rest?: string[];
}

/** Client-side sections, grouped by what they read. */
const CLIENT_NAV: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "history", label: "History", icon: Terminal, rest: ["list"] },
  { id: "prune", label: "Batch Prune", icon: Scissors },
  { id: "audit", label: "Audit Log", icon: ScrollText },
  { id: "doctor", label: "Doctor", icon: Stethoscope },
];

const SERVER_NAV: NavItem[] = [
  { id: "users", label: "Users", icon: Users },
  { id: "sessions", label: "Sessions", icon: KeyRound },
  { id: "activity", label: "Activity", icon: Activity },
];

function NavGroup({ title, items }: { title: string; items: NavItem[] }) {
  const { route, navigate } = useRouteStore();

  return (
    <div className="px-3 py-2">
      <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
        {title}
      </p>
      <div className="space-y-0.5">
        {items.map(({ id, label, icon: Icon, rest }) => {
          const active = route.section === id;
          return (
            <button
              key={id}
              onClick={() => navigate(id, ...(rest ?? []))}
              aria-current={active ? "page" : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-brand-soft text-brand font-medium"
                  : "text-ink-muted hover:text-ink hover:bg-hover"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 min-h-screen border-r border-line bg-raised flex flex-col">
      <div className="px-5 py-4 border-b border-line">
        <div className="flex items-center gap-2">
          <Keyboard size={20} className="text-brand" />
          <div>
            <p className="font-semibold text-ink text-sm leading-tight">Atuin</p>
            <p className="text-ink-subtle text-xs leading-tight">Dashboard</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-2">
        <NavGroup title="Shell history" items={CLIENT_NAV} />
        <NavGroup title="Sync server" items={SERVER_NAV} />
      </nav>
    </aside>
  );
}

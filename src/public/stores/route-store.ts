import { create } from "zustand";

/** Top-level sections. The hash owns client navigation; the path stays server-side. */
export type Section =
  | "overview"
  | "history"
  | "prune"
  | "audit"
  | "doctor"
  | "users"
  | "sessions"
  | "activity";

const SECTIONS: Section[] = [
  "overview",
  "history",
  "prune",
  "audit",
  "doctor",
  "users",
  "sessions",
  "activity",
];

export interface Route {
  section: Section;
  /** Everything after the section, e.g. ["list"] for #history/list. */
  rest: string[];
}

interface RouteState {
  route: Route;
  navigate: (section: Section, ...rest: string[]) => void;
  init: () => () => void;
}

const DEFAULT: Route = { section: "overview", rest: [] };

/**
 * Parses `#history/list` into a route.
 *
 * The server path (`/app`) and the client route are deliberately split by the
 * `#`: the fragment never reaches the server, so any client route deep-links
 * and reloads without needing a server-side catch-all per section.
 */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "").trim();
  if (!raw) return DEFAULT;

  const [head, ...rest] = raw.split("/").filter(Boolean);
  const section = SECTIONS.find((s) => s === head);
  if (!section) return DEFAULT;
  return { section, rest };
}

export function toHash(section: Section, rest: string[] = []): string {
  return `#${[section, ...rest].join("/")}`;
}

export const useRouteStore = create<RouteState>((set) => ({
  route: DEFAULT,

  navigate: (section, ...rest) => {
    const hash = toHash(section, rest);
    if (window.location.hash !== hash) window.location.hash = hash;
    set({ route: { section, rest } });
  },

  init: () => {
    const sync = () => set({ route: parseHash(window.location.hash) });
    sync();

    // Normalise a bare or unknown hash so the address bar always shows a
    // route that round-trips.
    if (!window.location.hash) {
      window.history.replaceState(null, "", toHash(DEFAULT.section));
    }

    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  },
}));

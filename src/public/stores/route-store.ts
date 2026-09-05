import { create } from "zustand";

/** Top-level sections. The hash owns client navigation; the path stays server-side. */
const SECTIONS = [
  "overview",
  "history",
  "prune",
  "audit",
  "doctor",
  "users",
  "sessions",
  "activity",
] as const;

/** Derived from SECTIONS so a section added to one cannot be missing from the
 *  other — the runtime list is what parseHash validates against. */
export type Section = (typeof SECTIONS)[number];

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

/** decodeURIComponent throws on a malformed escape; a bad URL is not a crash. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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
  return { section, rest: rest.map((r) => safeDecode(r)) };
}

export function toHash(section: Section, rest: string[] = []): string {
  // Encoded per segment: an unescaped "?" or "#" in a sub-route truncates the
  // fragment, and the app then reads a route it never wrote.
  return `#${[section, ...rest.map(encodeURIComponent)].join("/")}`;
}

export const useRouteStore = create<RouteState>((set) => ({
  route: DEFAULT,

  navigate: (section, ...rest) => {
    const hash = toHash(section, rest);
    if (window.location.hash !== hash) window.location.hash = hash;
    set({ route: { section, rest } });
  },

  init: () => {
    const sync = () => {
      const route = parseHash(window.location.hash);
      set({ route });

      // An unsupported fragment falls back to the default section, so rewrite
      // the address bar to match. Otherwise the URL keeps claiming a route the
      // app is not on, and sharing or reloading it is misleading.
      const canonical = toHash(route.section, route.rest);
      if (window.location.hash !== canonical) {
        window.history.replaceState(null, "", canonical);
      }
    };
    sync();

    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  },
}));

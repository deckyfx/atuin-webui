import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "auto";

interface ThemeState {
  preference: ThemePreference;
  /** What is actually on screen once "auto" is resolved against the OS. */
  resolved: "light" | "dark";
  setPreference: (pref: ThemePreference) => void;
  /** Subscribes to OS changes; returns an unsubscribe. */
  init: () => () => void;
}

const STORAGE_KEY = "atuin-dashboard:theme";

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStored(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return "auto";
}

/**
 * Applies the preference to the document.
 *
 * "auto" removes the attribute entirely rather than stamping a value, so the
 * stylesheet's prefers-color-scheme block is what decides -- keeping one source
 * of truth instead of mirroring the OS setting in JS.
 */
function apply(pref: ThemePreference): "light" | "dark" {
  const root = document.documentElement;
  if (pref === "auto") {
    root.removeAttribute("data-theme");
    return systemTheme();
  }
  root.setAttribute("data-theme", pref);
  return pref;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: "auto",
  // Resolved from the OS at construction rather than assumed: a hardcoded
  // "dark" is wrong for a light-mode viewer for the first render, which is
  // exactly when a flash of the wrong theme is visible.
  resolved: typeof window === "undefined" ? "light" : systemTheme(),

  setPreference: (pref) => {
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Non-fatal: the choice just will not survive a reload.
    }
    set({ preference: pref, resolved: apply(pref) });
  },

  init: () => {
    const pref = readStored();
    set({ preference: pref, resolved: apply(pref) });

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (get().preference === "auto") set({ resolved: systemTheme() });
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  },
}));

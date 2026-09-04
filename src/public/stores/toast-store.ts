import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** Pending dismissal timers, so a refreshed toast can cancel its predecessor. */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Beyond this the stack covers content it is meant to annotate. */
const MAX_TOASTS = 4;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (kind, message) => {
    const id = nextId++;
    // The id whose timer should fire. A repeat keeps the existing entry, so
    // scheduling against the new id would dismiss nothing and the surviving
    // toast would stay on screen forever.
    let timerId = id;
    set((s) => {
      // A failing action retried in a loop would otherwise stack one toast per
      // attempt until they covered the screen. Repeats of the same message
      // refresh the existing entry, and the list is capped.
      // A repeat moves the existing entry to the end rather than adding
      // another, so the newest occurrence is the one in view.
      const existing = s.toasts.find((t) => t.kind === kind && t.message === message);
      if (existing) {
        timerId = existing.id;
        // The earlier timer is still pending and would dismiss the refreshed
        // toast on the original schedule, cutting its visible life short.
        const pending = timers.get(existing.id);
        if (pending !== undefined) clearTimeout(pending);
        return { toasts: [...s.toasts.filter((t) => t.id !== existing.id), existing] };
      }
      const next = [...s.toasts, { id, kind, message }];
      // Anything pushed out by the cap keeps a pending timer that would later
      // fire against an id no longer on screen — and ids are reused by the
      // refresh path above, so a stale timer can dismiss a live toast.
      for (const dropped of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) {
        const pending = timers.get(dropped.id);
        if (pending !== undefined) {
          clearTimeout(pending);
          timers.delete(dropped.id);
        }
      }
      return { toasts: next.slice(-MAX_TOASTS) };
    });
    // Errors stay until dismissed; transient results clear themselves.
    if (kind !== "error") {
      const handle = setTimeout(() => {
        timers.delete(timerId);
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== timerId) }));
      }, 4000);
      timers.set(timerId, handle);
    }
  },

  dismiss: (id) => {
    // Cancel the pending timer too: dismissing by hand otherwise leaves it to
    // fire later against an id that may have been reused by a refreshed toast.
    const pending = timers.get(id);
    if (pending !== undefined) {
      clearTimeout(pending);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

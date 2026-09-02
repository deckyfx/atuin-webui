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
        return { toasts: [...s.toasts.filter((t) => t.id !== existing.id), existing] };
      }
      return { toasts: [...s.toasts, { id, kind, message }].slice(-MAX_TOASTS) };
    });
    // Errors stay until dismissed; transient results clear themselves.
    if (kind !== "error") {
      setTimeout(
        () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== timerId) })),
        4000
      );
    }
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

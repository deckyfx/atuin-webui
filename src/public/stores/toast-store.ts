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
    set((s) => {
      // A failing action retried in a loop would otherwise stack one toast per
      // attempt until they covered the screen. Repeats of the same message
      // refresh the existing entry, and the list is capped.
      const existing = s.toasts.find((t) => t.kind === kind && t.message === message);
      if (existing) return { toasts: s.toasts };
      return { toasts: [...s.toasts, { id, kind, message }].slice(-MAX_TOASTS) };
    });
    // Errors stay until dismissed; transient results clear themselves.
    if (kind !== "error") {
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
    }
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

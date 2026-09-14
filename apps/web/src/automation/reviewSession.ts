import type { createAutomationService } from './service';

export type AutomationService = ReturnType<typeof createAutomationService>;
let service: AutomationService | null = null;
let reviewing = false;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

/** Renderer-local binding, no transport, token, live handles or arbitrary state
 * setters exposed. Both native requests and review buttons use this service. */
export function bindReviewSession(next: AutomationService) {
  service = next; reviewing = false; emit();
  return () => { if (service === next) { service = null; reviewing = false; emit(); } };
}
export const reviewService = () => service;
export const isAgentReviewOpen = () => reviewing;
export function setAgentReviewOpen(open: boolean) { reviewing = open; emit(); }
export function subscribeReviewSession(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

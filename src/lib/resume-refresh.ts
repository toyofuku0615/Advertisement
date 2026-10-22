/** Revalidate the public snapshot when returning to the app, never in a background loop. */
export const PUBLISHED_RECHECK_INTERVAL_MS = 60_000;

interface ResumeRefreshOptions {
  documentTarget: EventTarget & { readonly visibilityState: string };
  windowTarget: EventTarget;
  lastAttemptAt: () => number;
  isLoading: () => boolean;
  requestRefresh: () => void;
  now?: () => number;
  minimumIntervalMs?: number;
}

export function installResumeRefresh({ documentTarget, windowTarget, lastAttemptAt, isLoading, requestRefresh, now = Date.now, minimumIntervalMs = PUBLISHED_RECHECK_INTERVAL_MS }: ResumeRefreshOptions): () => void {
  // Local gating also covers multiple lifecycle events before React begins a request.
  let lastRequestedAt = -Infinity;
  const check = () => {
    const current = now();
    if (documentTarget.visibilityState !== 'visible' || isLoading() || current - Math.max(lastAttemptAt(), lastRequestedAt) < minimumIntervalMs) return;
    lastRequestedAt = current;
    requestRefresh();
  };
  const restored = (event: Event) => { if ((event as PageTransitionEvent).persisted) check(); };
  documentTarget.addEventListener('visibilitychange', check);
  windowTarget.addEventListener('pageshow', restored);
  windowTarget.addEventListener('online', check);
  return () => {
    documentTarget.removeEventListener('visibilitychange', check);
    windowTarget.removeEventListener('pageshow', restored);
    windowTarget.removeEventListener('online', check);
  };
}

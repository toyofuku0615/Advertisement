import { describe, expect, it, vi } from 'vitest';
import { installResumeRefresh } from './resume-refresh';

function harness() {
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const windowTarget = new EventTarget();
  const state = { now: 120_000, lastAttempt: 0, loading: false };
  const requestRefresh = vi.fn();
  const remove = installResumeRefresh({ documentTarget, windowTarget, lastAttemptAt: () => state.lastAttempt, isLoading: () => state.loading, requestRefresh, now: () => state.now });
  return { documentTarget, windowTarget, state, requestRefresh, remove };
}

describe('returning to the published app', () => {
  it('checks once when visible even if online and restored-pageshow follow immediately', () => {
    const h = harness();
    h.documentTarget.dispatchEvent(new Event('visibilitychange'));
    h.windowTarget.dispatchEvent(new Event('online'));
    h.windowTarget.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(h.requestRefresh).toHaveBeenCalledTimes(1);
    h.state.now += 60_000;
    h.windowTarget.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(h.requestRefresh).toHaveBeenCalledTimes(2);
    h.remove();
  });

  it('does not fetch while hidden, already fetching, or within one minute of a manual fetch', () => {
    const h = harness();
    h.documentTarget.visibilityState = 'hidden';
    h.windowTarget.dispatchEvent(new Event('online'));
    h.documentTarget.dispatchEvent(new Event('visibilitychange'));
    h.documentTarget.visibilityState = 'visible';
    h.state.loading = true;
    h.documentTarget.dispatchEvent(new Event('visibilitychange'));
    h.state.loading = false;
    h.state.lastAttempt = h.state.now - 59_999;
    h.documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(h.requestRefresh).not.toHaveBeenCalled();
    h.state.now++;
    h.documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(h.requestRefresh).toHaveBeenCalledTimes(1);
    h.remove();
  });

  it('ignores initial pageshow and removes every listener on cleanup', () => {
    const h = harness();
    h.windowTarget.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    expect(h.requestRefresh).not.toHaveBeenCalled();
    h.remove();
    h.windowTarget.dispatchEvent(new Event('online'));
    h.windowTarget.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    h.documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(h.requestRefresh).not.toHaveBeenCalled();
  });
});

import { isBrowser } from "./utils/env";
import { now } from "./utils/now";

const supportsRequestIdleCallback: boolean =
  isBrowser && typeof window.requestIdleCallback === "function";

class IdleDeadline {
  private initTime: number;

  constructor(initTime: number) {
    this.initTime = initTime;
  }

  get didTimeout(): boolean {
    return false;
  }

  timeRemaining(): number {
    return Math.max(0, 50 - (now() - this.initTime));
  }
}

/**
 * Provides a cross-browser compatible shim for `requestIdleCallback` and
 * `cancelIdleCallback` if native support is not available. Note that the
 * shim's `timeRemaining` calculation is an approximation.
 */
function requestIdleCallbackShim(
  callback: (deadline: IdleDeadline) => void
): number {
  const deadline = new IdleDeadline(now());
  const timeoutId = setTimeout(() => callback(deadline), 0);
  return timeoutId as unknown as number;
}

function cancelIdleCallbackShim(handle: number | null): void {
  if (handle) {
    clearTimeout(handle);
  }
}

/**
 * The native `requestIdleCallback()` function or `requestIdleCallbackShim()`
 * if the browser doesn't support it.
 *
 * The bind is used to ensure that the context of
 * the requestIdleCallback and cancelIdleCallback methods is always the window object,
 * regardless of how or where these functions are called.
 */
export const rIC = supportsRequestIdleCallback
  ? window.requestIdleCallback.bind(window)
  : requestIdleCallbackShim;

/**
 * The native `cancelIdleCallback()` function or `cancelIdleCallbackShim()`
 * if the browser doesn't support it.
 *
 * The bind is used to ensure that the context of
 * the requestIdleCallback and cancelIdleCallback methods is always the window object,
 * regardless of how or where these functions are called.
 * */
export const cIC: (handle: number) => void = supportsRequestIdleCallback
  ? window.cancelIdleCallback.bind(window)
  : cancelIdleCallbackShim;

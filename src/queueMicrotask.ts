import { isBrowser } from "./utils/env";

type Microtask = () => void;

function createQueueMicrotaskViaPromises(): (microtask: Microtask) => void {
  return (microtask: Microtask) => {
    Promise.resolve().then(microtask);
  };
}

function createQueueMicrotaskViaMutationObserver(): (
  microtask: Microtask
) => void {
  let mutationCounter = 0;
  let microtaskQueue: Microtask[] = [];
  const observer = new MutationObserver(() => {
    microtaskQueue.forEach((microtask) => microtask());
    microtaskQueue = [];
  });
  const node = document.createTextNode("");
  observer.observe(node, { characterData: true });

  return (microtask: Microtask) => {
    microtaskQueue.push(microtask);

    // MutationObserver is a fallback for when native microtasks are unavailable
    node.data = String(++mutationCounter % 2);
  };
}

/**
 * Schedules a microtask using the best available browser method
 * - queueMicrotask
 * - Promises
 * - MutationObserver
 */
export function createQueueMicrotask(): (microtask: Microtask) => void {
  if (isBrowser && typeof queueMicrotask === "function") {
    // The microtask is a short function which will run after the current task has completed its work
    // and when there is no other code waiting to be run before control of the execution context is returned
    // to the browser's event loop.
    return queueMicrotask.bind(window);
  } else if (
    typeof Promise === "function" &&
    Promise.toString().includes("[native code]")
  ) {
    return createQueueMicrotaskViaPromises();
  } else {
    return createQueueMicrotaskViaMutationObserver();
  }
}

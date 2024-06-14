import { cIC, rIC } from "./idleCbWithPolyfill";
import { createQueueMicrotask } from "./queueMicrotask";
import { isBrowser, isSafari } from "./utils/env";
import { now } from "./utils/now";

interface VoidFunction {
  (): void;
}

interface State {
  time: number;
  visibilityState: "hidden" | "visible" | "prerender" | "unloaded";
}

type Task = (state: State) => void;

interface TaskQueueItem {
  state: State;
  task: Task;
  minTaskTime: number;
}

type TaskQueue = TaskQueueItem[];

const DEFAULT_MIN_TASK_TIME = 0;
const MAX_TASKS_PER_ITERATION = 20;

/**
 * Returns true if the IdleDeadline object exists and the remaining time is
 * less or equal to than the minTaskTime. Otherwise returns false.
 */
function shouldYield(deadline?: IdleDeadline, minTaskTime?: number): boolean {
  // deadline.timeRemaining() means the time remaining till the browser is idle
  return !!(deadline && deadline.timeRemaining() <= (minTaskTime || 0));
}

/**
 * IdleQueue manages a queue of tasks designed to be executed during browser idle time.
 * It allows checking whether tasks are pending and ensures task execution.
 */
export class IdleQueue {
  private idleCallbackHandle: number | null = null;
  private taskQueue: TaskQueue = [];
  private isProcessing = false;
  private state: State | null = null;
  private defaultMinTaskTime: number = DEFAULT_MIN_TASK_TIME;
  private maxTasksPerIteration: number = MAX_TASKS_PER_ITERATION;
  private ensureTasksRun = false;
  private queueMicrotask?: (callback: VoidFunction) => void;

  /**
   * Creates the IdleQueue instance and adds lifecycle event listeners to
   * run the queue if the page is hidden (with fallback behavior for Safari).
   */
  constructor({
    ensureTasksRun = false,
    defaultMinTaskTime = DEFAULT_MIN_TASK_TIME,
    maxTasksPerIteration = MAX_TASKS_PER_ITERATION,
  }: {
    ensureTasksRun?: boolean;
    defaultMinTaskTime?: number;
    maxTasksPerIteration?: number;
  } = {}) {
    this.defaultMinTaskTime = defaultMinTaskTime;
    this.ensureTasksRun = ensureTasksRun;
    this.maxTasksPerIteration = maxTasksPerIteration;

    this.runTasksImmediately = this.runTasksImmediately.bind(this);
    this.runTasks = this.runTasks.bind(this);

    if (isBrowser && this.ensureTasksRun) {
      addEventListener(
        "visibilitychange",
        () => {
          if (document.visibilityState === "hidden") this.runTasksImmediately();
        },
        true
      );

      if (isSafari) {
        // Safari workaround: Due to unreliable event behavior, we use 'beforeunload'
        // to ensure tasks run if a tab/window is closed unexpectedly.
        // NOTE: we only add this to Safari because adding it to Firefox would
        // prevent the page from being eligible for bfcache.
        addEventListener("beforeunload", this.runTasksImmediately, true);
      }
    }
  }

  pushTask(task: Task, options?: { minTaskTime?: number }): void {
    this.handleTask(task, this.taskQueue.push.bind(this.taskQueue), options);
  }

  unshiftTask(task: Task, options?: { minTaskTime?: number }): void {
    this.handleTask(task, this.taskQueue.unshift.bind(this.taskQueue), options);
  }

  /**
   * Runs all scheduled tasks synchronously.
   */
  runTasksImmediately(): void {
    // By not passing a deadline, all tasks will be run sync.
    this.runTasks();
  }

  hasPendingTasks(): boolean {
    return this.taskQueue.length > 0;
  }

  /**
   * Clears all pending tasks for the queue and stops any scheduled tasks from running.
   */
  clearPendingTasks(): void {
    this.taskQueue = [];
    this.cancelScheduledRun();
  }

  /**
   * Returns the state object for the currently running task.
   * If no task is running, null is returned.
   */
  getState(): State | null {
    return this.state;
  }

  /**
   * Destroys the instance by un-registering all added event listeners and
   * removing any overridden methods.
   */
  destroy(): void {
    this.taskQueue = [];
    this.cancelScheduledRun();

    if (isBrowser && this.ensureTasksRun) {
      removeEventListener("visibilitychange", this.runTasksImmediately, true);

      if (isSafari) {
        removeEventListener("beforeunload", this.runTasksImmediately, true);
      }
    }
  }

  private handleTask(
    task: Task,
    handleTaskQueueItem: (taskQueueItem: TaskQueueItem) => number,
    options?: { minTaskTime?: number }
  ): void {
    const state: State = {
      time: now(),
      visibilityState: isBrowser ? document.visibilityState : "visible",
    };

    const minTaskTime: number = Math.max(
      0,
      (options && options.minTaskTime) || this.defaultMinTaskTime
    );

    handleTaskQueueItem({
      state,
      task,
      minTaskTime,
    });

    this.scheduleTasksToRun();
  }

  /**
   * Schedules the task queue to be processed. If the document is in the
   * hidden state, they queue is scheduled as a microtask so it can be run
   * in cases where a macrotask couldn't (like if the page is unloading). If
   * the document is in the visible state, `requestIdleCallback` is used.
   */
  private scheduleTasksToRun(): void {
    if (
      isBrowser &&
      this.ensureTasksRun &&
      document.visibilityState === "hidden"
    ) {
      this.queueMicrotask ||= createQueueMicrotask();
      this.queueMicrotask(this.runTasks);
    } else {
      this.idleCallbackHandle ||= rIC(this.runTasks) as number;
    }
  }

  /**
   * Runs as many tasks in the queue as it can before reaching the
   * deadline. If no deadline is passed, it will run all tasks.
   * If an `IdleDeadline` object is passed (as is with `requestIdleCallback`)
   * then the tasks are run until there's no time remaining, at which point
   * we yield to input or other script and wait until the next idle time.
   */
  private runTasks(deadline?: IdleDeadline): void {
    this.cancelScheduledRun();

    if (!this.isProcessing) {
      this.isProcessing = true;
      let tasksProcessed = 0;

      // Process tasks until:
      // - there's no time left;
      // - and for fixed iterations (maxTasksPerIteration) so that the main thread is not kept blocked;
      // - and till we need to yield to input.
      while (
        this.hasPendingTasks() &&
        tasksProcessed < this.maxTasksPerIteration &&
        !shouldYield(deadline, this.taskQueue[0].minTaskTime)
      ) {
        const taskQueueItem = this.taskQueue.shift();

        if (taskQueueItem) {
          const { task, state } = taskQueueItem;

          this.state = state;

          try {
            task(state);
          } catch (error) {
            console.error("Error running IdleQueue Task: ", error);
          }

          this.state = null;
          tasksProcessed++;
        }
      }

      this.isProcessing = false;

      if (this.hasPendingTasks()) {
        // Schedule the rest of the tasks for the next idle time.
        this.scheduleTasksToRun();
      }
    }
  }

  /**
   * Cancels any scheduled idle callback and removes the handler (if set).
   */
  private cancelScheduledRun(): void {
    if (this.idleCallbackHandle) {
      cIC(this.idleCallbackHandle);
    }

    this.idleCallbackHandle = null;
  }
}

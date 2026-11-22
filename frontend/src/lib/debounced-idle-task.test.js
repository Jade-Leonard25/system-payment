import { describe, expect, test } from "bun:test";
import { createDebouncedIdleTask } from "./debounced-idle-task";

function createFakeHost({ idle = true } = {}) {
  let nextId = 0;
  const timers = new Map();
  const idleCallbacks = new Map();
  return {
    timers,
    idleCallbacks,
    setTimeout(callback) {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestIdleCallback: idle
      ? (callback, options) => {
          const id = ++nextId;
          idleCallbacks.set(id, { callback, options });
          return id;
        }
      : undefined,
    cancelIdleCallback(id) {
      idleCallbacks.delete(id);
    },
    runTimer(id) {
      const callback = timers.get(id);
      timers.delete(id);
      callback?.();
    },
    runIdle(id) {
      const entry = idleCallbacks.get(id);
      idleCallbacks.delete(id);
      entry?.callback();
    },
  };
}

describe("createDebouncedIdleTask", () => {
  test("defers work until after the debounce and browser idle periods", () => {
    const host = createFakeHost();
    let runs = 0;
    const task = createDebouncedIdleTask(() => runs++, { host });

    task.schedule();
    expect(runs).toBe(0);
    const [debounceId] = host.timers.keys();
    host.runTimer(debounceId);
    expect(runs).toBe(0);

    const [idleId] = host.idleCallbacks.keys();
    expect(host.idleCallbacks.get(idleId).options).toEqual({ timeout: 1000 });
    host.runIdle(idleId);
    expect(runs).toBe(1);
  });

  test("runs only once for repeated edits during the debounce period", () => {
    const host = createFakeHost();
    let runs = 0;
    const task = createDebouncedIdleTask(() => runs++, { host });

    task.schedule();
    const oldTimer = [...host.timers.keys()][0];
    task.schedule();
    expect(host.timers.has(oldTimer)).toBe(false);
    const currentTimer = [...host.timers.keys()][0];
    host.runTimer(currentTimer);
    const [idleId] = host.idleCallbacks.keys();
    host.runIdle(idleId);

    expect(runs).toBe(1);
  });

  test("flushes pending work immediately and cancels scheduled callbacks", () => {
    const host = createFakeHost();
    let runs = 0;
    const task = createDebouncedIdleTask(() => runs++, { host });

    task.schedule();
    task.flush();
    expect(runs).toBe(1);
    expect(host.timers.size).toBe(0);
    expect(host.idleCallbacks.size).toBe(0);
    task.flush();
    expect(runs).toBe(1);
  });

  test("uses a timer fallback when requestIdleCallback is unavailable", () => {
    const host = createFakeHost({ idle: false });
    let runs = 0;
    const task = createDebouncedIdleTask(() => runs++, { host });

    task.schedule();
    const [debounceId] = host.timers.keys();
    host.runTimer(debounceId);
    expect(runs).toBe(0);
    const [idleTimerId] = host.timers.keys();
    host.runTimer(idleTimerId);

    expect(runs).toBe(1);
  });
});

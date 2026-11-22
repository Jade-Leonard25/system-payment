export function createDebouncedIdleTask(task, { delay = 300, host = window } = {}) {
  let debounceTimer = null;
  let idleHandle = null;
  let idleHandleIsTimer = false;
  let pending = false;

  const cancelTimers = () => {
    if (debounceTimer !== null) {
      host.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (idleHandle !== null) {
      if (!idleHandleIsTimer && typeof host.cancelIdleCallback === "function") {
        host.cancelIdleCallback(idleHandle);
      } else {
        host.clearTimeout(idleHandle);
      }
      idleHandle = null;
    }
  };

  const run = () => {
    idleHandle = null;
    pending = false;
    task();
  };

  return {
    schedule() {
      cancelTimers();
      pending = true;
      debounceTimer = host.setTimeout(() => {
        debounceTimer = null;
        if (typeof host.requestIdleCallback === "function") {
          idleHandleIsTimer = false;
          idleHandle = host.requestIdleCallback(run, { timeout: 1000 });
        } else {
          idleHandleIsTimer = true;
          idleHandle = host.setTimeout(run, 0);
        }
      }, delay);
    },
    flush() {
      if (!pending) return;
      cancelTimers();
      pending = false;
      task();
    },
    cancel() {
      cancelTimers();
      pending = false;
    },
  };
}

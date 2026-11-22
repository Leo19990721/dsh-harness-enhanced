/** Continue existing, independent batch controls. The adapter owns all UI state. */
export function createExpansion(clock, idleMs = 1200) {
  const active = new Map();

  function cancel(control) {
    const job = active.get(control);
    if (!job) return;
    active.delete(control);
    job.unwatch();
    clock.clearTimeout(job.timer);
    if (job.frame !== undefined) clock.cancelAnimationFrame(job.frame);
  }

  function track(control, { read, watch, advance }) {
    cancel(control);
    const shown = read();
    if (shown === undefined) return;
    const job = { shown };
    const isCurrent = () => active.get(control) === job;
    const arm = () => {
      clock.clearTimeout(job.timer);
      job.deadline = clock.now() + idleMs;
      job.timer = clock.setTimeout(() => { if (isCurrent()) cancel(control); }, idleMs);
    };
    const measure = () => {
      const current = clock.now() < job.deadline ? read() : undefined;
      if (current === undefined) cancel(control);
      return current;
    };
    active.set(control, job);
    job.unwatch = watch(() => {
      if (!isCurrent() || measure() === undefined || job.frame !== undefined) return;
      job.frame = clock.requestAnimationFrame(() => {
        job.frame = undefined;
        if (!isCurrent()) return;
        const current = measure();
        if (current === undefined || current <= job.shown) return;
        job.shown = current;
        arm();
        advance();
      });
    });
    arm();
  }

  return {
    track,
    cancel,
    dispose() {
      for (const control of active.keys()) cancel(control);
    },
  };
}

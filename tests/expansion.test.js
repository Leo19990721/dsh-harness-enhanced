import assert from 'node:assert/strict';
import test from 'node:test';
import { createExpansion } from '../expansion.js';

function setup() {
  let now = 0, seq = 0;
  const frames = new Map(), timers = new Map();
  const expansion = createExpansion({
    now: () => now,
    setTimeout(fn, delay) { const id = ++seq; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = ++seq; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const frame = () => {
    const ready = [...frames.keys()];
    for (const id of ready) {
      const run = frames.get(id);
      frames.delete(id);
      run?.();
    }
  };
  const elapse = (ms, runTimers = true) => {
    now += ms;
    if (runTimers) {
      for (const [id, { fn, at }] of timers) if (now >= at) { timers.delete(id); fn(); }
    }
  };
  const group = (total, base = 5) => {
    const control = {}, state = { shown: Math.min(base, total), attached: true, allowed: true, extra: 0 };
    let pending = 0;
    let listener;
    function commit() {
      if (pending === 0) return;
      pending--;
      state.shown = state.shown === total ? base : Math.min(total, state.shown + 5);
      listener?.();
    }
    function click() {
      expansion.track(control, {
        read: () => state.attached && state.allowed && state.shown < total ? state.shown : undefined,
        watch(fn) { listener = fn; return () => { listener = undefined; }; },
        advance() { state.extra++; pending++; },
      });
      // First click (and collapse) still runs the native handler.
      pending++;
      commit();
    }
    return { control, state, click, commit, get pending() { return pending; }, signal() { listener?.(); } };
  };
  function drain(...groups) {
    for (let rounds = 0; frames.size || groups.some(g => g.pending); rounds++) {
      assert.ok(rounds < 500, 'expansion failed to terminate');
      frame();
      for (const g of groups) g.commit();
    }
  }
  return { group, expansion, frame, elapse, drain, frames, timers };
}

for (const [total, extra] of [[6, 0], [11, 1], [16, 2], [72, 13], [1001, 199]]) {
  test(`one click shows all ${total} sessions; native collapse still restores five`, () => {
    const h = setup();
    const g = h.group(total);
    g.click();
    h.drain(g);
    assert.equal(g.state.shown, total);
    assert.equal(g.state.extra, extra);
    assert.equal(h.timers.size, 0);
    g.click();
    h.drain(g);
    assert.equal(g.state.shown, 5);
    assert.equal(g.state.extra, extra);
  });
}

test('only the clicked group expands; a second group can be queued independently', () => {
  const h = setup();
  const parent = h.group(22), child = h.group(31), sameNameElsewhere = h.group(16);
  parent.click();
  child.click();
  h.drain(parent, child, sameNameElsewhere);
  assert.equal(parent.state.shown, 22);
  assert.equal(child.state.shown, 31);
  assert.equal(sameNameElsewhere.state.shown, 5);
  assert.equal(sameNameElsewhere.state.extra, 0);
});

test('uses the native baseline, including when current or active sessions raise it', () => {
  const h = setup();
  const g = h.group(40, 17);
  g.click();
  h.drain(g);
  assert.equal(g.state.shown, 40);
  g.click();
  assert.equal(g.state.shown, 17);
  assert.equal(h.frames.size, 0);
});

test('waits for a real increase, coalesces duplicate notifications, and expires on a stall', () => {
  const h = setup();
  const g = h.group(30);
  g.click();
  g.signal();
  g.signal();
  assert.equal(h.frames.size, 1);
  h.frame();
  assert.equal(g.state.extra, 1);
  g.signal();
  h.frame();
  assert.equal(g.state.extra, 1);
  h.elapse(1200);
  g.commit();
  assert.equal(g.state.shown, 15);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
});

for (const reason of ['button disconnected', 'group closed', 'second pointerdown', 'plugin disabled', 'frame paused past timeout']) {
  test(`drops a queued continuation when ${reason}`, () => {
    const h = setup();
    const g = h.group(30);
    g.click();
    assert.equal(h.frames.size, 1);
    if (reason === 'button disconnected') g.state.attached = false;
    if (reason === 'group closed') g.state.allowed = false;
    if (reason === 'second pointerdown') h.expansion.cancel(g.control);
    if (reason === 'plugin disabled') h.expansion.dispose();
    if (reason === 'frame paused past timeout') h.elapse(1250, false);
    h.drain(g);
    assert.equal(g.state.shown, 10);
    assert.equal(g.state.extra, 0);
    assert.equal(h.timers.size, 0);
  });
}

test('a quick manual collapse cancels any continuation and is left collapsed', () => {
  const h = setup();
  const g = h.group(11);
  g.click();
  h.frame();
  g.commit(); // Native final batch.
  g.click(); // User clicks the now-visible collapse button.
  h.drain(g);
  assert.equal(g.state.shown, 5);
  assert.equal(g.state.extra, 1);
});

test('a list with nothing hidden starts no work', () => {
  const h = setup();
  const g = h.group(5);
  g.click();
  assert.equal(g.state.shown, 5);
  assert.equal(g.state.extra, 0);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
});

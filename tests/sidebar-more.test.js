import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const compiled = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const left = 'sidebar.panellist.actions';
const otherMenus = ['conversation.session.header.views.actions', 'sidebar.right.tab.guide.actions'];

// Exercise the packaged adapter against the exact Slot and observable contract.
// These tests do not render a sidebar or impersonate an authenticated client.
function setup({ declared = true, mutable = true, hasMenu = true, rejectRefresh = false } = {}) {
  const watch = new Set();
  const mutations = [];
  const panels = [{ id: 'plugins' }, { id: 'toolbox' }, { id: 'schedules' }];
  const menu = { id: 'entry-customization' };
  const entries = new Map([[left, hasMenu ? [menu] : []], ...otherMenus.map(key => [key, [menu]])]);
  const source = {
    getSnapshot() { return entries.get(left).length > 0; },
    subscribe(listener) { watch.add(listener); return () => watch.delete(listener); },
  };
  if (!mutable) Object.freeze(source);
  const original = source.getSnapshot;
  const native = {
    locale: 'sidebar', children: { [left]: { kind: 'list', scope: 'root' } },
    inject: () => ({ hooks: { entryActions: source, panels } }),
  };
  let rebind, cleanup;
  const notify = () => { for (const listener of watch) listener(); };
  const registry = {
    inject(name, run) {
      assert.equal(name, left);
      rebind = () => { cleanup = run(); };
      if (declared) rebind();
    },
    entries(name) {
      assert.equal(name, 'sidebar');
      return [{ locale: 'addon' }, native];
    },
    register(options, render) {
      assert.equal(options.name, left);
      assert.equal(render(), null);
      if (rejectRefresh) throw new Error('refresh rejected');
      mutations.push('register');
      const bucket = entries.get(left);
      bucket.push(options);
      notify();
      return () => {
        mutations.push('dispose');
        bucket.splice(bucket.indexOf(options), 1);
        notify();
      };
    },
  };
  let mod;
  runInNewContext(compiled, { window: { __ModuleLoader__: { load(value) { mod = value; } } } });
  assert.equal(mod.id, '@local/dsh-harness-enhanced');
  const plugin = mod.factory();
  assert.equal(plugin.inject.join(','), 'slots');
  return {
    // Optional recovery services aren't part of this sidebar-only surface.
    enable: () => plugin.apply({ slots: registry, effect() {}, inject() {} }),
    declare: () => rebind(),
    collapse: () => cleanup?.(),
    source, original, entries, panels, mutations, native,
  };
}

test('hot activation suppresses only the left More gate for existing subscribers; cleanup restores it', () => {
  const h = setup();
  const sideMenus = otherMenus.map(key => h.entries.get(key));
  const snapshot = () => h.source.getSnapshot();
  const seen = [snapshot()];
  const stop = h.source.subscribe(() => seen.push(snapshot()));
  const face = h.native.inject();
  h.enable();
  assert.deepEqual(seen, [true, false]);
  assert.equal(face.hooks.entryActions, h.source);
  assert.equal(face.hooks.panels, h.panels);
  assert.equal(h.native.inject().hooks.panels, h.panels);
  assert.equal(h.entries.get(left).length, 2);
  for (const [i, key] of otherMenus.entries()) assert.equal(h.entries.get(key), sideMenus[i]);
  h.collapse();
  assert.deepEqual(seen, [true, false, true]);
  assert.equal(h.source.getSnapshot, h.original);
  assert.deepEqual(h.entries.get(left), [{ id: 'entry-customization' }]);
  assert.deepEqual(h.mutations, ['register', 'dispose']);
  stop();
});

test('waits for the menu declaration and reattaches after its lifecycle changes', () => {
  const h = setup({ declared: false });
  h.enable();
  assert.deepEqual(h.mutations, []);
  h.declare();
  assert.equal(h.source.getSnapshot(), false);
  h.collapse();
  h.declare();
  assert.equal(h.source.getSnapshot(), false);
  h.collapse();
  assert.equal(h.source.getSnapshot(), true);
  assert.deepEqual(h.mutations, ['register', 'dispose', 'register', 'dispose']);
});

test('does not leave a More button when there were no native menu contributions', () => {
  const h = setup({ hasMenu: false });
  assert.equal(h.source.getSnapshot(), false);
  h.enable();
  assert.equal(h.source.getSnapshot(), false);
  h.collapse();
  assert.equal(h.source.getSnapshot(), false);
  assert.deepEqual(h.entries.get(left), []);
});

test('keeps native behavior when its observable is not compatible', () => {
  const h = setup({ mutable: false });
  h.enable();
  h.collapse();
  assert.equal(h.source.getSnapshot, h.original);
  assert.equal(h.source.getSnapshot(), true);
  assert.deepEqual(h.mutations, []);
});

test('restores the native snapshot if registration fails', () => {
  const h = setup({ rejectRefresh: true });
  assert.throws(() => h.enable(), /refresh rejected/);
  assert.equal(h.source.getSnapshot, h.original);
  assert.equal(h.source.getSnapshot(), true);
});

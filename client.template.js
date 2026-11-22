window.__ModuleLoader__.load({
  id: '@local/dsh-harness-enhanced',
  factory(require) {
    /* __EXPANSION_CONTROLLER__ */
    /* __FAILED_MESSAGE_UI__ */

    const overflow = 'button[type="button"][data-row-key^="overflow:"][aria-expanded]';
    const listArea = '[data-sidebar-list-area]';
    const treeRole = '[role="tree"]';
    const rowRole = '[role="treeitem"][data-row-key]';
    const unavailable = '[inert], [aria-hidden="true"]';

    function ownRow(child) {
      if (child?.matches(rowRole)) return child;
      // HoverCard wraps workspace and session anchors in a role-less span.
      // A nested workspace uses a div[role=group]; never traverse it.
      if (!child?.matches('span:not([role])')) return;
      const anchor = child.firstElementChild;
      if (anchor?.matches(rowRole)) return anchor;
    }

    function attach(view) {
      const { document } = view;
      const expansion = createExpansion({
        now: () => view.performance.now(),
        setTimeout: view.setTimeout.bind(view),
        clearTimeout: view.clearTimeout.bind(view),
        requestAnimationFrame: view.requestAnimationFrame.bind(view),
        cancelAnimationFrame: view.cancelAnimationFrame.bind(view),
      });

      function onInput(event) {
        if (!event.isTrusted || event.button !== 0) return;
        const button = event.target?.closest?.(overflow);
        if (!button) return;
        // Do not move this button between a second pointerdown and its click.
        expansion.cancel(button);
        if (event.type !== 'click' || button.ownerDocument !== document
            || button.getAttribute('aria-expanded') !== 'false') return;

        const area = button.closest(listArea);
        const tree = button.closest(treeRole);
        const group = button.parentElement;
        if (!area || !tree || !area.contains(tree) || !group) return;
        const key = button.getAttribute('data-row-key');
        // The native Ungrouped bucket uses the empty key and an unwrapped header.
        const headerKey = `workspace:${key.slice('overflow:'.length)}`;
        const headerSeat = group.firstElementChild;
        const header = ownRow(headerSeat);
        if (header?.getAttribute('data-row-key') !== headerKey) return;

        expansion.track(button, {
          read() {
            // Never retarget a re-rendered button, another group, or an open/collapsed control.
            if (event.defaultPrevented || !button.isConnected || button.ownerDocument !== document
                || button.parentElement !== group || !button.matches(overflow) || button.getAttribute('data-row-key') !== key
                || button.getAttribute('aria-expanded') !== 'false' || button.matches(':disabled')
                || button.getAttribute('aria-disabled') === 'true' || button.closest(unavailable)
                || group.firstElementChild !== headerSeat || ownRow(headerSeat) !== header
                || header.getAttribute('data-row-key') !== headerKey || header.getAttribute('aria-expanded') !== 'true'
                || button.closest(listArea) !== area || button.closest(treeRole) !== tree || !area.contains(tree)) return;
            let shown = 0;
            for (const seat of group.children) {
              if (ownRow(seat)?.getAttribute('data-row-key').startsWith('session:')) shown++;
            }
            return shown;
          },
          watch(onCommit) {
            const observer = new view.MutationObserver(onCommit);
            observer.observe(group, { childList: true });
            observer.observe(button, {
              attributes: true, attributeFilter: ['aria-expanded', 'disabled', 'aria-disabled', 'data-row-key', 'type'],
            });
            observer.observe(header, { attributes: true, attributeFilter: ['aria-expanded', 'data-row-key', 'role'] });
            return () => observer.disconnect();
          },
          // The native click handler still owns the row limit and all collapse behavior.
          advance: () => button.click(),
        });
      }

      document.addEventListener('click', onInput, true);
      document.addEventListener('pointerdown', onInput, true);
      return () => {
        document.removeEventListener('click', onInput, true);
        document.removeEventListener('pointerdown', onInput, true);
        expansion.dispose();
      };
    }

    function hideSidebarMore(slots) {
      const menuSlot = 'sidebar.panellist.actions';
      return slots.inject(menuSlot, () => {
        const native = slots.entries('sidebar').find(entry => entry.locale === 'sidebar'
          && entry.children?.[menuSlot]?.kind === 'list' && entry.children[menuSlot].scope === 'root'
          && typeof entry.inject === 'function');
        // In DSH rc.5 this face holds the same observable that the sidebar's selector reads.
        const source = native?.inject()?.hooks?.entryActions;
        const original = source && Object.getOwnPropertyDescriptor(source, 'getSnapshot');
        if (!original?.writable || typeof original.value !== 'function' || typeof source.subscribe !== 'function') {
          return () => {};
        }

        let hidden = true;
        function snapshot() { return hidden ? false : original.value.call(this); }
        source.getSnapshot = snapshot;
        const restore = () => {
          hidden = false;
          if (source.getSnapshot === snapshot) source.getSnapshot = original.value;
        };

        // Notify the native source's current subscribers through its own slot. The
        // entry draws nothing and does not replace or unregister any menu actions.
        let refresh;
        try {
          refresh = slots.register({ name: menuSlot, id: 'harness-enhanced.sidebar-more-visibility' }, () => null);
        } catch (error) {
          restore();
          throw error;
        }
        return () => {
          restore();
          return refresh();
        };
      });
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => attach(window), 'harness-enhanced: expand remaining sessions');
        hideSidebarMore(ctx.slots);
        ctx.inject(['slots', 'locale', 'layout', 'sessions', 'conversation', 'connection'], scope => {
          registerFailedMessage(scope, require('react'));
        });
      },
    };
  },
});

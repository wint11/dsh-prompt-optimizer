/**
 * 客户端半侧：输入框右下角的提示词优化按钮。
 *
 * 点击后把草稿交给宿主改写（宿主用当前会话的模型），期间在输入框区域扫光，
 * 完成后写回草稿，按钮切成撤销图标，5 秒后收回。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-prompt-optimizer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const ROUTE = '/dsh-prompt-optimizer/optimize';
    const UNDO_MS = 5000;

    const PATHS = {
      spark: 'M12 2.6l1.9 5.2 5.2 1.9-5.2 1.9L12 16.8l-1.9-5.2L4.9 9.7l5.2-1.9zM19 14l.9 2.4 2.4.9-2.4.9L19 20.6l-.9-2.4-2.4-.9 2.4-.9z',
      undo: 'M9 7H7.5a5.5 5.5 0 1 0 0 11H15M9 7l3-3M9 7l3 3',
      spinner: 'M12 3a9 9 0 1 0 9 9',
      check: 'M5 13l4.5 4.5L19 7',
    };

    const CSS = `
/* 扫光打在文字上：渐变填进字形，只让一条高光带从文字上流过。
   currentColor 仍是原文字色，所以基础段落看起来没变，只有高光经过时字才亮。 */
[data-dsh-po-shine="true"] {
  background-image: linear-gradient(
    100deg,
    currentColor 0%,
    currentColor 36%,
    rgba(126, 174, 255, 0.95) 47%,
    rgba(196, 222, 255, 1) 51%,
    currentColor 62%,
    currentColor 100%
  );
  background-size: 280% 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  caret-color: currentColor;
  animation: dsh-po-text-sweep 1.15s linear infinite;
}
@keyframes dsh-po-text-sweep {
  from { background-position: 145% 0; }
  to { background-position: -45% 0; }
}
@keyframes dsh-po-spin { to { transform: rotate(360deg); } }
@keyframes dsh-po-pop { from { transform: scale(0.6); opacity: 0.4; } to { transform: scale(1); opacity: 1; } }
`;

    function ensureCss() {
      if (document.getElementById('dsh-po-css') !== null) return;
      const tag = document.createElement('style');
      tag.id = 'dsh-po-css';
      tag.textContent = CSS;
      document.head.append(tag);
    }

    function Icon({ name }) {
      const stroked = name !== 'spark';
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: PATHS[name],
          fill: stroked ? 'none' : 'currentColor',
          stroke: stroked ? 'currentColor' : 'none',
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
    }

    // 找扫光目标：从按钮向上找含可编辑区的祖先，取那个可编辑区；
    // 祖先里没有就退到与按钮横向重叠最多的可编辑区。找不到就返回 null，不做任何效果。
    function findEditor(anchor) {
      let node = anchor;
      for (let depth = 0; depth < 16 && node; depth += 1) {
        const editor = typeof node.querySelector === 'function' ? node.querySelector('[contenteditable="true"]') : null;
        if (editor !== null) return editor;
        node = node.parentElement;
      }
      const anchorBox = anchor.getBoundingClientRect();
      let best = null;
      let bestOverlap = 0;
      for (const editor of document.querySelectorAll('[contenteditable="true"]')) {
        const box = editor.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        const overlap = Math.min(box.right, anchorBox.right) - Math.max(box.left, anchorBox.left);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = editor;
        }
      }
      return best;
    }

    // 找出真正承载文字的节点：编辑区（Lexical）把文字放在内层 span 里，
    // 只在容器上裁切背景会让子节点继承透明的文字填充色，字反而看不见。
    // 所以逐个元素判断"是否直接含非空文本节点"，只给这些元素打高光。
    function textBearingNodes(root) {
      const targets = [];
      const visit = (element) => {
        let hasText = false;
        for (const child of element.childNodes) {
          if (child.nodeType === 3 && child.nodeValue !== null && child.nodeValue.trim() !== '') {
            hasText = true;
            break;
          }
        }
        if (hasText) targets.push(element);
        for (const child of element.children) visit(child);
      };
      visit(root);
      return targets;
    }

    // 扫光开关：给承载文字的元素打属性，CSS 把渐变裁进字形；结束逐个摘掉并还原内联样式。
    function startShine(anchor) {
      if (!anchor) return () => {};
      const editor = findEditor(anchor);
      if (editor === null) return () => {};
      const targets = textBearingNodes(editor);
      // 空输入框没有文字可扫：此时扫光无处附着，直接不扫（按钮本身已有转圈状态）。
      if (targets.length === 0) return () => {};
      const saved = targets.map((element) => element.getAttribute('style'));
      for (const element of targets) element.setAttribute('data-dsh-po-shine', 'true');
      return () => {
        targets.forEach((element, index) => {
          element.removeAttribute('data-dsh-po-shine');
          const previous = saved[index];
          if (previous === null) element.removeAttribute('style');
          else element.setAttribute('style', previous);
        });
      };
    }

    function createControl(ctx) {
      return function OptimizeButton({ sessionId }) {
        ensureCss();
        const [busy, setBusy] = React.useState(false);
        const [undo, setUndo] = React.useState(undefined);
        const [done, setDone] = React.useState(false);
        const [error, setError] = React.useState(undefined);
        const buttonRef = React.useRef(null);

        const draftApi = React.useMemo(() => {
          const sessions = ctx.get('sessions');
          const conversation = ctx.get('conversation');
          if (!sessionId || typeof sessions?.scope !== 'function' || typeof conversation?.input?.for !== 'function') return undefined;
          const scope = sessions.scope(sessionId);
          return scope === undefined ? undefined : conversation.input.for(scope);
        }, [sessionId]);

        const read = () => (typeof draftApi?.state?.getSnapshot === 'function' ? draftApi.state.getSnapshot().draft ?? '' : '');
        const write = (value) => draftApi?.setDraft?.(value);

        const optimize = async () => {
          if (busy || !draftApi) return;
          const original = read();
          if (original.trim() === '') return;
          setBusy(true);
          setError(undefined);
          setUndo(undefined);
          setDone(false);
          const stopScan = startShine(buttonRef.current);
          try {
            const response = await fetch(ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text: original }),
            });
            const body = await response.json().catch(() => ({ ok: false, reason: 'bad-response' }));
            if (!response.ok || body.ok !== true || typeof body.text !== 'string') {
              throw new Error(body.message || body.reason || 'HTTP ' + response.status);
            }
            // 先收扫光再写回：写草稿会让编辑器重建文本节点，抢在重建前摘掉属性更干净。
            stopScan();
            write(body.text);
            setUndo({ original, optimized: body.text });
            setDone(true);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            stopScan();
            setBusy(false);
          }
        };

        const revert = () => {
          if (undo === undefined) return;
          // 撤销窗口内用户已改过草稿：不回滚，直接收起，避免覆盖他自己的输入。
          if (read() === undo.optimized) write(undo.original);
          setUndo(undefined);
          setDone(false);
        };

        React.useEffect(() => {
          if (undo === undefined) return;
          const timer = setTimeout(() => setUndo(undefined), UNDO_MS);
          return () => clearTimeout(timer);
        }, [undo]);

        // 完成态：按钮变勾 1.2s 再切撤销图标，用户能看见"已经改完了"。
        React.useEffect(() => {
          if (!done) return;
          const timer = setTimeout(() => setDone(false), 1200);
          return () => clearTimeout(timer);
        }, [done]);

        const isUndo = undo !== undefined;
        const title = busy
          ? '正在优化…'
          : done
            ? '优化完成'
            : isUndo
              ? '撤销优化'
              : error === undefined
                ? '优化提示词'
                : '优化失败：' + error;
        const icon = busy ? 'spinner' : done ? 'check' : isUndo ? 'undo' : 'spark';

        return h(
          'button',
          {
            type: 'button',
            ref: buttonRef,
            'data-dsh-prompt-optimizer': busy ? 'busy' : done ? 'done' : isUndo ? 'undo' : 'optimize',
            title,
            'aria-label': title,
            'aria-busy': busy ? 'true' : undefined,
            disabled: busy || draftApi === undefined,
            onClick: isUndo ? revert : optimize,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              padding: 0,
              border: 0,
              borderRadius: 8,
              background: 'transparent',
              color: done
                ? 'var(--dsw-alias-text-accent, #4d8ef7)'
                : isUndo
                  ? 'var(--dsw-alias-text-primary, inherit)'
                  : 'var(--dsw-alias-text-secondary, #8a8a8a)',
              cursor: busy ? 'progress' : 'pointer',
              opacity: busy || draftApi === undefined ? 0.5 : 1,
              transition: 'color 160ms ease',
            },
          },
          h(
            'span',
            {
              style: {
                display: 'block',
                animation: busy ? 'dsh-po-spin 1s linear infinite' : done ? 'dsh-po-pop 260ms ease-out' : undefined,
              },
            },
            h(Icon, { name: icon }),
          ),
        );
      };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(
          () => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'prompt-optimizer' }, createControl(ctx))),
          'prompt-optimizer: composer button',
        );
      },
    };
  },
});

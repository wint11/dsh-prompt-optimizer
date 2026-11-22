/**
 * 客户端半侧：输入框右下角的提示词优化按钮，以及浮在输入框上方的澄清对话条。
 *
 * 点按钮把草稿交给宿主，宿主用当前会话的模型判断：还需要问清楚吗，还是可以给结果了。
 * 需要问就一次问一个关键点，用户点选项或自己打字回答；问到没有关键歧义了再改写并写回草稿。
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
      close: 'M6 6l12 12M18 6L6 18',
      send: 'M4 12h15M13 6l6 6-6 6',
      prev: 'M14.5 6.5L9 12l5.5 5.5',
      next: 'M9.5 6.5L15 12l-5.5 5.5',
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
@keyframes dsh-po-fade { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  [data-dsh-po-shine="true"] { animation: none; }
  .dsh-po-body { animation: none; }
}
/* 面板外形照抄宿主 composer dock 的既有面板（如待办面板）：同一套宽度扣除规则、
   同一套菜单底色与投影，这样贴在输入框上方时看起来是输入区的一部分。 */
.dsh-po-panel {
  box-sizing: border-box;
  flex: none;
  overflow: hidden;
  margin: 0 auto;
  width: calc(
    100% -
    var(--dsh-composer-side-clearance, 0px) -
    var(--dsh-composer-side-clearance, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px)
  );
  max-width: calc(
    var(--dsh-composer-card-max-width, 100%) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px)
  );
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  box-shadow: var(--dsw-elevation-panel);
  font-family: var(--dsw-font-family);
}
.dsh-po-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
}
.dsh-po-lead {
  display: grid;
  flex: none;
  place-items: center;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-po-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-po-step {
  flex: none;
  padding: 0 2px;
  font-size: 12px;
  line-height: 24px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-po-close {
  display: grid;
  flex: none;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.dsh-po-close:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.dsh-po-close:disabled { opacity: 0.3; cursor: default; }
/* 翻页时面板高度不抖：问题区留一个最小高度。 */
.dsh-po-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 116px;
  padding: 0 12px 10px;
  animation: dsh-po-fade 160ms ease-out;
}
.dsh-po-ask {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}
.dsh-po-question {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}
.dsh-po-key {
  display: grid;
  flex: none;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 4px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  transition: background 140ms ease, color 140ms ease;
}
.dsh-po-askkey {
  background: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dsh-po-opts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dsh-po-opt {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 4px 8px 4px 4px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.dsh-po-opt:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-po-opt:hover .dsh-po-key {
  background: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
.dsh-po-opt[aria-pressed="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-po-opt[aria-pressed="true"] .dsh-po-key {
  background: var(--dsw-alias-label-secondary);
  color: var(--dsw-specific-menu, var(--dsw-alias-label-tertiary));
}
.dsh-po-opttext {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
.dsh-po-askblock {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dsh-po-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 2px;
}
.dsh-po-dots { display: flex; flex: 1 1 auto; gap: 4px; min-width: 0; }
.dsh-po-dot {
  width: 5px;
  height: 5px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-border-l3);
  cursor: pointer;
  transition: background 140ms ease, width 140ms ease;
}
/* 已答的点和当前页的点用不同强弱，翻页时能看出进度。 */
.dsh-po-dot[data-filled="true"] { background: var(--dsw-alias-label-tertiary); }
.dsh-po-dot[aria-current="true"] { width: 14px; background: var(--dsw-alias-label-secondary); }
.dsh-po-dot:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);
  outline-offset: 2px;
}
.dsh-po-submit {
  padding: 4px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease, opacity 140ms ease;
}
.dsh-po-submit:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l4);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-po-submit:disabled { opacity: 0.4; cursor: default; }
.dsh-po-input {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 5px 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 18px;
}
.dsh-po-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dsh-po-input:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}
.dsh-po-close:focus-visible,
.dsh-po-opt:focus-visible,
.dsh-po-submit:focus-visible,
.dsh-po-input:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}
.dsh-po-note {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-po-note-error { color: var(--dsw-alias-label-danger, var(--dsw-alias-label-secondary)); }
.dsh-po-thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-po-thinking svg { animation: dsh-po-spin 1s linear infinite; }
`;

    function ensureCss() {
      if (document.getElementById('dsh-po-css') !== null) return;
      const tag = document.createElement('style');
      tag.id = 'dsh-po-css';
      tag.textContent = CSS;
      document.head.append(tag);
    }

    /** 澄清对话要跨两个 slot 共享（按钮在 input.right、对话条在 input.dock），
     *  用一个极小订阅仓库传，避免把组件树串起来。按会话分别存，切走再切回来还在。 */
    function createStore() {
      const bySession = new Map();
      const EMPTY = { phase: 'idle', history: [], questions: [] };
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) listener();
      };
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        get(sessionId) {
          return bySession.get(sessionId) ?? EMPTY;
        },
        set(sessionId, state) {
          if (state.phase === 'idle') bySession.delete(sessionId);
          else bySession.set(sessionId, state);
          emit();
        },
        clear(sessionId) {
          if (!bySession.has(sessionId)) return;
          bySession.delete(sessionId);
          emit();
        },
      };
    }

    function Icon({ name, size = 16 }) {
      const stroked = name !== 'spark';
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
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

    /** 两个 slot 都靠它拿同一份草稿接口；sessionId 变了就重取。 */
    function useDraft(ctx, sessionId) {
      return React.useMemo(() => {
        const sessions = ctx.get('sessions');
        const conversation = ctx.get('conversation');
        if (!sessionId || typeof sessions?.scope !== 'function' || typeof conversation?.input?.for !== 'function') return undefined;
        const scope = sessions.scope(sessionId);
        return scope === undefined ? undefined : conversation.input.for(scope);
      }, [sessionId]);
    }

    function readDraft(draftApi) {
      return typeof draftApi?.state?.getSnapshot === 'function' ? draftApi.state.getSnapshot().draft ?? '' : '';
    }

    /** 问一轮：把原始提示词和已有问答带上，宿主回一个问句或最终改写。 */
    async function ask(base, history, signal) {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: base, history }),
        signal,
      });
      const body = await response.json().catch(() => ({ ok: false, reason: 'bad-response' }));
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || body.reason || 'HTTP ' + response.status);
      }
      return body;
    }

    /** 点完选项该去哪儿：优先下一条；已在末条则跳到第一条还没答的；
     *  全部答完了就整批提交。省掉手动点下一页。 */
    function nextStep(questions, answers, index) {
      if (index < questions.length - 1) return { cursor: index + 1 };
      const pending = questions.findIndex(
        (item, itemIndex) => itemIndex !== index && (answers[item.id] ?? '').trim() === '',
      );
      return pending !== -1 ? { cursor: pending } : { submit: true };
    }

    function createControl(ctx, store) {
      return function OptimizeButton({ sessionId }) {
        ensureCss();
        const [busy, setBusy] = React.useState(false);
        const [undo, setUndo] = React.useState(undefined);
        const [done, setDone] = React.useState(false);
        const [error, setError] = React.useState(undefined);
        const buttonRef = React.useRef(null);

        const draftApi = useDraft(ctx, sessionId);
        const state = store.get(sessionId);

        const start = async () => {
          if (busy || !draftApi) return;
          const original = readDraft(draftApi);
          if (original.trim() === '') return;
          setBusy(true);
          setError(undefined);
          setUndo(undefined);
          setDone(false);
          // 原始草稿留在仓库里，后续每一轮都拿它做基准，避免多轮改写层层叠加。
          store.set(sessionId, { phase: 'thinking', base: original, history: [], questions: [] });
          const stopScan = startShine(buttonRef.current);
          const controller = new AbortController();
          try {
            const body = await ask(original, [], controller.signal);
            if (body.action === 'ask') {
              store.set(sessionId, {
                phase: 'asking',
                base: original,
                history: [],
                questions: body.questions ?? [],
              });
            } else {
              stopScan();
              draftApi.setDraft?.(body.text);
              store.clear(sessionId);
              setUndo({ original, optimized: body.text });
              setDone(true);
            }
          } catch (cause) {
            store.set(sessionId, {
              phase: 'error',
              base: original,
              history: [],
              questions: [],
              error: cause instanceof Error ? cause.message : String(cause),
            });
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            stopScan();
            setBusy(false);
          }
        };

        const revert = () => {
          if (undo === undefined) return;
          // 撤销窗口内用户已改过草稿：不回滚，直接收起，避免覆盖他自己的输入。
          if (readDraft(draftApi) === undo.optimized) draftApi.setDraft?.(undo.original);
          setUndo(undefined);
          setDone(false);
          store.clear(sessionId);
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
        const asking = state.phase !== 'idle';
        const title = busy
          ? '正在优化…'
          : asking
            ? '正在澄清，点这里继续'
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
            onClick: isUndo ? revert : start,
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
                : asking
                  ? 'var(--dsw-alias-label-primary)'
                  : isUndo
                    ? 'var(--dsw-alias-label-primary)'
                    : 'var(--dsw-alias-label-tertiary)',
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

    function createPanel(ctx, store) {
      return function ClarifyPanel({ sessionId }) {
        ensureCss();
        const draftApi = useDraft(ctx, sessionId);
        // 订阅用 useReducer 强制重渲染、每次渲染直接读仓库：仓库是外部普通对象，
        // 这样不依赖快照身份比较，写入后必定刷新。
        const [, bump] = React.useReducer((n) => n + 1, 0);
        React.useEffect(() => store.subscribe(bump), []);
        // 每条问题一个草稿答案：点选项写入，也可以自己打字覆盖。
        const [answers, setAnswers] = React.useState({});
        // 一次只显示一条，靠光标翻页。
        const [cursor, setCursor] = React.useState(0);

        const state = store.get(sessionId);
        React.useEffect(() => {
          if (state.phase !== 'asking') setCursor(0);
        }, [state.phase, state.questions]);
        if (state.phase === 'idle') return null;

        const setAnswer = (id, value) => setAnswers((previous) => ({ ...previous, [id]: value }));
        const filled = state.questions.filter((item) => (answers[item.id] ?? '').trim() !== '');
        const index = Math.max(0, Math.min(cursor, state.questions.length - 1));
        const current = state.questions[index];
        const go = (next) => setCursor(Math.max(0, Math.min(next, state.questions.length - 1)));

        const submit = async (override) => {
          const chosen = override ?? answers;
          const ready = state.questions.filter((item) => (chosen[item.id] ?? '').trim() !== '');
          if (state.phase !== 'asking' || ready.length === 0) return;
          // 没答的问题记为跳过，不塞进记录，后续轮次也就不会再被问同样的点。
          const history = [
            ...state.history,
            ...ready.map((item) => ({ question: item.question, answer: chosen[item.id].trim() })),
          ];
          setAnswers({});
          setCursor(0);
          store.set(sessionId, { ...state, phase: 'thinking', history });
          try {
            const body = await ask(state.base, history);
            if (body.action === 'ask') {
              store.set(sessionId, {
                phase: 'asking',
                base: state.base,
                history,
                questions: body.questions ?? [],
              });
              return;
            }
            draftApi?.setDraft?.(body.text);
            store.clear(sessionId);
          } catch (cause) {
            store.set(sessionId, {
              ...state,
              phase: 'error',
              history,
              error: cause instanceof Error ? cause.message : String(cause),
            });
          }
        };

        /** 点选项就算答完这一条：自动翻到下一条；末条则跳到还没答的；
         *  全都答过了直接提交。 */
        const pick = (id, value) => {
          const chosen = { ...answers, [id]: value };
          setAnswers(chosen);
          const step = nextStep(state.questions, chosen, index);
          if (step.submit) submit(chosen);
          else go(step.cursor);
        };

        // 重试上一批：把 history 里最后这批问答摘掉重新提交，避免重复累积。
        const retry = () => {
          const dropped = Math.min(state.history.length, state.questions.length);
          const history = state.history.slice(0, state.history.length - dropped);
          store.set(sessionId, { ...state, phase: 'asking', history, error: undefined });
        };

        return h(
          'section',
          { className: 'dsh-po-panel', 'aria-label': '改写前的澄清' },
          h(
            'div',
            { className: 'dsh-po-head' },
            h('span', { className: 'dsh-po-lead', 'aria-hidden': true }, h(Icon, { name: 'spark' })),
            h('span', { className: 'dsh-po-title' }, '改写前先确认'),
            state.phase === 'asking' && state.questions.length > 1
              ? h('span', { className: 'dsh-po-step' }, index + 1 + ' / ' + state.questions.length)
              : null,
            state.phase === 'asking'
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-po-close',
                      title: '上一条',
                      'aria-label': '上一条',
                      disabled: index === 0,
                      onClick: () => go(index - 1),
                    },
                    h(Icon, { name: 'prev' }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-po-close',
                      title: '下一条',
                      'aria-label': '下一条',
                      disabled: index >= state.questions.length - 1,
                      onClick: () => go(index + 1),
                    },
                    h(Icon, { name: 'next' }),
                  ),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-po-close',
                title: '结束澄清，保留当前输入',
                'aria-label': '结束澄清',
                onClick: () => store.clear(sessionId),
              },
              h(Icon, { name: 'close' }),
            ),
          ),
          h(
            'div',
            { className: 'dsh-po-body' },
            state.phase === 'thinking'
              ? h(
                  'div',
                  { className: 'dsh-po-thinking' },
                  h(Icon, { name: 'spinner' }),
                  h('span', {}, state.history.length === 0 ? '正在读你的输入…' : '正在整理…'),
                )
              : null,
            state.phase === 'error'
              ? h(
                  'div',
                  { className: 'dsh-po-note dsh-po-note-error' },
                  state.error,
                  state.questions.length > 0
                    ? h(
                        'button',
                        { type: 'button', className: 'dsh-po-close', title: '重试', onClick: retry },
                        h(Icon, { name: 'send' }),
                      )
                    : null,
                )
              : null,
            state.phase === 'asking' && current
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { key: current.id, className: 'dsh-po-askblock' },
                    h(
                      'div',
                      { className: 'dsh-po-ask' },
                      h(
                        'span',
                        { className: 'dsh-po-key dsh-po-askkey', 'aria-hidden': true },
                        state.questions.length > 1 ? String(index + 1) : '问',
                      ),
                      h('div', { className: 'dsh-po-question' }, current.question),
                    ),
                    current.options.length > 0
                      ? h(
                          'div',
                          { className: 'dsh-po-opts' },
                          current.options.map((option, optionIndex) =>
                            h(
                              'button',
                              {
                                key: option,
                                type: 'button',
                                className: 'dsh-po-opt',
                                'aria-pressed': answers[current.id] === option ? 'true' : 'false',
                                onClick: () => pick(current.id, option),
                              },
                              h(
                                'span',
                                { className: 'dsh-po-key', 'aria-hidden': true },
                                String.fromCharCode(65 + optionIndex),
                              ),
                              h('span', { className: 'dsh-po-opttext' }, option),
                            ),
                          ),
                        )
                      : null,
                    h('input', {
                      className: 'dsh-po-input',
                      value: answers[current.id] ?? '',
                      placeholder: current.options.length > 0 ? '或自己写一句' : '写一句回答',
                      'aria-label': current.question,
                      onChange: (event) => setAnswer(current.id, event.target.value),
                      onKeyDown: (event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        // 手写回答后回车：下一条，末条则跳到未答或提交。
                        const step = nextStep(state.questions, answers, index);
                        if (step.submit) submit();
                        else go(step.cursor);
                      },
                    }),
                  ),
                  h(
                    'div',
                    { className: 'dsh-po-foot' },
                    h(
                      'div',
                      { className: 'dsh-po-dots' },
                      state.questions.map((item, dotIndex) =>
                        h('button', {
                          key: item.id,
                          type: 'button',
                          className: 'dsh-po-dot',
                          'data-filled': (answers[item.id] ?? '').trim() !== '' ? 'true' : 'false',
                          'aria-current': dotIndex === index ? 'true' : undefined,
                          'aria-label': '第 ' + (dotIndex + 1) + ' 条',
                          onClick: () => go(dotIndex),
                        }),
                      ),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-po-submit',
                        disabled: filled.length === 0,
                        onClick: () => submit(),
                      },
                      filled.length === state.questions.length && filled.length > 0
                        ? '提交'
                        : '提交 ' + filled.length + ' / ' + state.questions.length,
                    ),
                  ),
                )
              : null,
          ),
        );
      };
    }

    return {
      inject: ['slots'],
      // 供自检直接验证翻页决策；模块加载器只取 inject/apply。
      nextStep,
      apply(ctx) {
        const store = createStore();
        const OptimizeButton = createControl(ctx, store);
        const ClarifyPanel = createPanel(ctx, store);
        ctx.effect(
          () => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'prompt-optimizer' }, OptimizeButton)),
          'prompt-optimizer: composer button',
        );
        // input.dock 渲染在输入框上方，与待办面板同一个位置族。
        ctx.effect(
          () => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'prompt-optimizer-gaps', order: 10 }, ClarifyPanel)),
          'prompt-optimizer: clarify panel',
        );
      },
    };
  },
});

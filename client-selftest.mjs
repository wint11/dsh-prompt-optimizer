// 用最小桩验证客户端模块结构：工厂能加载、两个 slot 都注册、组件可被调用一次。
import assert from 'node:assert/strict';

const registrations = [];
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      const mod = factory((name) => {
        if (name === 'react') {
          return {
            createElement: (type, props, ...children) => ({ type, props, children }),
            useState: (initial) => [initial, () => {}],
            useEffect: () => {},
            useMemo: (fn) => fn(),
            useReducer: (reducer, initial) => [initial, () => {}],
            useRef: () => ({ current: null }),
            useSyncExternalStore: (_sub, get) => get(),
          };
        }
        throw new Error('unexpected require: ' + name);
      });
      registrations.push({ id, mod });
    },
  },
};
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ set textContent(v) {}, set id(v) {} }),
  head: { append: () => {} },
  querySelectorAll: () => [],
};

await import('./client.js');

assert.equal(registrations.length, 1, '应加载一个客户端模块');
const { id, mod } = registrations[0];
assert.equal(id, '@local/dsh-prompt-optimizer');
assert.deepEqual(mod.inject, ['slots']);

const registered = [];
const ctx = {
  get: () => undefined,
  effect(fn, label) {
    fn();
    registered.push(label);
    return () => {};
  },
  slots: {
    inject(_owner, cb) {
      cb();
    },
    register(options) {
      registered.push(options.name + '#' + options.id);
      return () => {};
    },
  },
};
mod.apply(ctx);

assert.ok(registered.includes('conversation.input.right#prompt-optimizer'), '按钮 slot 应注册');
assert.ok(registered.includes('conversation.input.dock#prompt-optimizer-gaps'), '澄清条应挂在输入框上方的 dock');

// 点选项后的翻页决策：下一条 → 跳到未答 → 全部答完则提交
const qs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
assert.deepEqual(mod.nextStep(qs, {}, 0), { cursor: 1 }, '非末条应翻到下一条');
assert.deepEqual(mod.nextStep(qs, { a: 'x', b: 'y' }, 2), { submit: true }, '全答完应提交');
assert.deepEqual(mod.nextStep(qs, { b: 'y' }, 2), { cursor: 0 }, '末条答完应跳到还没答的第一条');

console.log('client module ok: ' + registered.filter((r) => r.includes('#')).join(', '));

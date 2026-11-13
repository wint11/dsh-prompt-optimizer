/**
 * 宿主半侧：把输入框里的提示词交给当前会话的模型改写一次。
 *
 * 只做三件事：校验请求、取当前模型、跑一次生成。改写规则全在这里，
 * 客户端只负责读草稿、发请求、写回草稿。
 */
export const name = 'prompt-optimizer';
export const inject = ['webServer', 'llm', 'agentDefaultModel'];

const ROUTE = '/dsh-prompt-optimizer';
const MAX_INPUT_CHARS = 20_000;
const MAX_BODY_BYTES = 256 * 1024;
const TIMEOUT_MS = 120_000;

const SYSTEM_PROMPT = [
  '你是提示词改写器。把用户给你的原始输入改写成一条更清晰、更可执行的提示词。',
  '保真：只改表达与结构，不新增需求、不改变意图、不编造事实或素材；原文里的专有名词、路径、代码、数字、约束照原样保留。',
  '改写要点：补全目标与期望产出；把含糊处改成具体可判断的描述；拆出必要的约束与边界；必要时指明输出格式。',
  '语言：与原文一致（中文进中文出）。',
  '篇幅：大致与原文字数相当，明显更短更好；不要加解释、前言、结语、标题，也不要包在代码块围栏里。',
  '只输出改写后的提示词本身，不要输出任何其他内容。',
].join('\n');

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** 收集流里的可见文本，并按块下标去重：一次生成里 text-delta（增量）和 block-end
 *  （完成态）装的是同一段内容，两者相加会整段翻倍。同一 index 只取一份，优先增量。 */
export async function collectText(stream) {
  const byIndex = new Map();
  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== 'object') continue;
    const index = typeof chunk.index === 'number' ? chunk.index : 0;
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      const slot = byIndex.get(index) ?? { delta: '', block: undefined };
      slot.delta += chunk.text;
      byIndex.set(index, slot);
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
      const slot = byIndex.get(index) ?? { delta: '', block: undefined };
      slot.block = chunk.block.text;
      byIndex.set(index, slot);
    }
  }
  const order = [...byIndex.keys()].sort((a, b) => a - b);
  const parts = order.map((index) => {
    const slot = byIndex.get(index);
    return slot.delta !== '' ? slot.delta : (slot.block ?? '');
  });
  return parts.join('').trim();
}

/** 模型偶尔把整段改写结果原样输出两遍（A + A）。按非空白字符判断前后两半是否相同，
 *  相同就只留前半：这是内容层的重复，靠 chunk 下标区分不出来。 */
export function collapseRepeat(text) {
  const trimmed = text.trim();
  const dense = trimmed.replace(/\s+/g, '');
  const half = Math.floor(dense.length / 2);
  if (dense.length < 8 || dense.length % 2 !== 0 || dense.slice(0, half) !== dense.slice(half)) return trimmed;
  let seen = 0;
  let cut = 0;
  for (; cut < trimmed.length; cut += 1) {
    if (/\s/.test(trimmed[cut])) continue;
    if (seen === half) break;
    seen += 1;
  }
  while (cut < trimmed.length && /\s/.test(trimmed[cut])) cut += 1;
  return trimmed.slice(0, cut).trim();
}

function stripFence(text) {
  return text
    .replace(/^```[^\n]*\n/, '')
    .replace(/\n?```$/, '')
    .trim();
}

export function apply(ctx) {
  const optimize = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, reason: 'method-not-allowed' });
      return;
    }

    let text;
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body.text !== 'string') throw new Error('missing "text"');
      text = body.text.trim();
    } catch (error) {
      sendJson(res, 400, { ok: false, reason: 'bad-request', message: String(error?.message ?? error) });
      return;
    }
    if (text === '') {
      sendJson(res, 400, { ok: false, reason: 'empty-text' });
      return;
    }
    if (text.length > MAX_INPUT_CHARS) {
      sendJson(res, 413, { ok: false, reason: 'text-too-large', limit: MAX_INPUT_CHARS });
      return;
    }

    // 当前模型取不到就不生成：不静默换模型，让客户端把原因显示出来。
    let selection;
    try {
      selection = ctx.agentDefaultModel.currentSelection();
    } catch (error) {
      sendJson(res, 409, { ok: false, reason: 'no-model', message: String(error?.message ?? error) });
      return;
    }
    if (!selection?.provider || !selection?.model) {
      sendJson(res, 409, { ok: false, reason: 'no-model', message: '当前会话未选择模型' });
      return;
    }

    let text_ = '';
    try {
      const result = await collectText(
        ctx.llm.stream({
          provider: selection.provider,
          model: selection.model,
          sessionId: 'dsh-prompt-optimizer',
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }],
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      );
      text_ = collapseRepeat(stripFence(result));
      if (text_ === '') {
        sendJson(res, 502, { ok: false, reason: 'no-text' });
        return;
      }
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-prompt-optimizer] generate failed: ${String(error?.message ?? error)}`);
      sendJson(res, 502, { ok: false, reason: 'generate-error', message: String(error?.message ?? error) });
      return;
    }

    sendJson(res, 200, { ok: true, text: text_, model: selection.provider + '/' + selection.model });
  };

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: optimize }),
    'prompt-optimizer: optimize route',
  );
}

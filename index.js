/**
 * 宿主半侧：把输入框里的提示词当成一次需要澄清的改写会话。
 *
 * 每次请求带上一段原始提示词和此前的问答记录，模型只做一个动作：
 * 要么再问一批关键问题，要么给出最终改写。问答全部发生在改写之前，
 * 客户端只负责收集回答、最后把结果写回草稿。
 */
export const name = 'prompt-optimizer';
export const inject = ['webServer', 'llm', 'agentDefaultModel'];

const ROUTE = '/dsh-prompt-optimizer';
const MAX_INPUT_CHARS = 20_000;
const MAX_ANSWER_CHARS = 2_000;
const MAX_HISTORY = 12;
const MAX_BATCH = 4;
const MAX_OPTIONS = 4;
const MAX_OPTION_CHARS = 60;
const MAX_QUESTION_CHARS = 120;
const MAX_BODY_BYTES = 256 * 1024;
const TIMEOUT_MS = 120_000;
const MAX_QUESTIONS = 8;

const SYSTEM_PROMPT = [
  '你是一名提示词澄清搭档。用户会给你一段他自己写的原始提示词，以及你们到目前为止的问答记录。',
  '你的目标：在动手改写之前，先把决定成品形态的关键歧义问清楚；问清楚了再给出改写结果。',
  '每轮只输出一个 JSON 对象，不要输出任何其他内容，不要包在代码块围栏里。两种形态二选一：',
  '{"action":"ask","questions":[{"id":"q1","question":"一句直接问用户的话","options":["候选答案一","候选答案二"]}]}',
  '{"action":"final","text":"改写后的完整提示词"}',
  // 批量问的核心约束：只有互不依赖的问题才能同批，否则后面的问法会被前面的答案推翻。
  '一次可以问多个问题，最多 4 个。一批里只放彼此独立的问题：任意两个问题，答了其中一个也不会改变另一个该怎么问、该不该问。',
  '存在依赖时必须拆批，例如"用什么技术栈"和"单文件还是分模块"不能同批，因为后者取决于前者。先问被依赖的那批，拿到答案后再决定下一批。',
  '问题写法：question 以疑问句结尾，二十字左右，不解释为什么要问，不铺陈背景；只有真正独立的点才占一个位置，凑不满就少问几个。',
  'options 给 2 到 4 个短答案，每个不超过二十字，用户点一下就当作回答；确实无法预设选项时给空数组。',
  '提问准则：只问那些答案不同、成品就会明显不同的点；能从原文直接读出的不要问；不要追问用户没提到的领域知识；纯措辞偏好不要问。',
  '改写准则：只把原文已有的意图说清楚、补出结构与可判断的标准；不新增原文没有的需求，不编造事实与素材；专有名词、路径、代码、数字、约束照原样保留；不要堆砌通用最佳实践，不要把小需求撑成大文档。',
  '语言与原文一致（中文进中文出）。',
  '提问次数有限，用户消息里会写明剩余次数；剩 0 次时必须输出 final。',
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
    } else if (chunk.type === 'block-end' && typeof chunk.text === 'string') {
      const slot = byIndex.get(index) ?? { delta: '', block: undefined };
      slot.block = chunk.text;
      byIndex.set(index, slot);
    }
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, slot]) => (slot.delta !== '' ? slot.delta : slot.block ?? ''))
    .join('');
}

/** 模型偶尔把同一段话整段重复一遍；只保留前半份。
 *  判据必须严格，否则正常的重复用词会被误砍。 */
export function collapseRepeat(text) {
  const half = Math.floor(text.length / 2);
  if (half === 0) return text;
  const head = text.slice(0, half);
  const tail = text.slice(half);
  return head === tail ? head : text;
}

function stripFence(text) {
  return text
    .replace(/^\s*```[a-zA-Z]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
}

/** 归一化一批问题：问句非空才留，选项去空截断，最多 MAX_BATCH 条。
 *  模型偶尔仍按旧格式给单个 question/options，顺手兼容一下。 */
export function normalizeQuestions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const questions = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const question = typeof item.question === 'string' ? item.question.trim().slice(0, MAX_QUESTION_CHARS) : '';
    if (question === '' || seen.has(question)) continue;
    const options = Array.isArray(item.options)
      ? item.options
          .filter((option) => typeof option === 'string' && option.trim() !== '')
          .map((option) => option.trim().slice(0, MAX_OPTION_CHARS))
          .slice(0, MAX_OPTIONS)
      : [];
    seen.add(question);
    questions.push({
      id: typeof item.id === 'string' && item.id !== '' ? item.id : 'q' + (questions.length + 1),
      question,
      options,
    });
    if (questions.length >= MAX_BATCH) break;
  }
  return questions;
}

/** 解析模型这一轮的动作。问句优先；能解析出最终文本就当收尾；
 *  什么都没解析出来的裸文本也按最终结果处理，避免整次改写白跑。 */
export function parseAction(raw) {
  const cleaned = stripFence(collapseRepeat(raw));
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    let parsed;
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      parsed = undefined;
    }
    if (parsed && typeof parsed === 'object') {
      if (parsed.action === 'ask') {
        // 新旧两种问法都收：批量 questions 数组优先，退到单个 question。
        const questions = normalizeQuestions(Array.isArray(parsed.questions) ? parsed.questions : [parsed]);
        if (questions.length > 0) return { action: 'ask', questions };
      }
      const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
      if (text !== '') return { action: 'final', text };
    }
  }
  return { action: 'final', text: cleaned };
}

/** 校验客户端带来的问答记录：只保留结构正确的条目，超长截断，超量丢弃最早的部分。 */
export function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const history = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
    if (question === '' || answer === '') continue;
    history.push({ question, answer: answer.slice(0, MAX_ANSWER_CHARS) });
  }
  return history.slice(-MAX_HISTORY);
}

function buildUserMessage(text, history, remaining) {
  const lines = ['原始提示词：', text, '', '已澄清：'];
  if (history.length === 0) lines.push('（暂无）');
  else history.forEach((item, index) => lines.push(`${index + 1}. 问：${item.question}`, `   答：${item.answer}`));
  lines.push('', `剩余提问次数：${remaining}`);
  if (remaining <= 0) lines.push('剩余为 0，本轮必须输出 final。');
  return lines.join('\n');
}

export function apply(ctx) {
  const optimize = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, reason: 'method-not-allowed' });
      return;
    }

    let text;
    let history;
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body.text !== 'string') throw new Error('missing "text"');
      text = body.text.trim();
      history = normalizeHistory(body.history);
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

    const remaining = Math.max(0, MAX_QUESTIONS - history.length);
    let action;
    try {
      const raw = await collectText(
        ctx.llm.stream({
          provider: selection.provider,
          model: selection.model,
          sessionId: 'dsh-prompt-optimizer',
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: buildUserMessage(text, history, remaining) }],
              source: { kind: 'user' },
            },
          ],
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      );
      action = parseAction(raw);
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-prompt-optimizer] generate failed: ${String(error?.message ?? error)}`);
      sendJson(res, 502, { ok: false, reason: 'generate-error', message: String(error?.message ?? error) });
      return;
    }

    // 到上限还提问就是违约：明确报错，客户端保留问答记录，重试一轮就能收口。
    if (action.action === 'ask' && remaining <= 0) {
      sendJson(res, 502, { ok: false, reason: 'ask-after-limit', message: '提问次数已用完，模型仍在提问' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      action: action.action,
      questions: action.questions,
      text: action.text,
      model: selection.provider + '/' + selection.model,
    });
  };

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: optimize }),
    'prompt-optimizer: optimize route',
  );
}

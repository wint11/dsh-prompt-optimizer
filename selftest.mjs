import assert from 'node:assert/strict';
import { parseAction, normalizeQuestions, normalizeHistory, collapseRepeat } from './index.js';

// 批量问句：多条一起返回，各自的选项保留
const batch = parseAction(
  '{"action":"ask","questions":[{"id":"q1","question":"用哪个框架？","options":["React","Vue"]},{"id":"q2","question":"要接后端吗？","options":[]}]}',
);
assert.equal(batch.action, 'ask');
assert.equal(batch.questions.length, 2);
assert.deepEqual(batch.questions[0].options, ['React', 'Vue']);
assert.deepEqual(batch.questions[1].options, []);

// 旧格式单个 question 也能收，保证不因格式回退丢问句
const legacy = parseAction('{"action":"ask","question":"用哪个框架？","options":["React"]}');
assert.equal(legacy.action, 'ask');
assert.equal(legacy.questions.length, 1);
assert.equal(legacy.questions[0].question, '用哪个框架？');

// 一批最多 4 条
const many = normalizeQuestions(
  Array.from({ length: 6 }, (_, i) => ({ question: 'q' + i + '？', options: ['a'] })),
);
assert.equal(many.length, 4);

// 重复问句去重，空问句丢弃
assert.equal(normalizeQuestions([{ question: 'a？' }, { question: 'a？' }, { question: '  ' }]).length, 1);

// 选项超量、超长都收紧
const opts = normalizeQuestions([{ question: 'q？', options: ['a', 'b', 'c', 'd', 'e'] }]);
assert.equal(opts[0].options.length, 4);

// 最终动作
const final = parseAction('{"action":"final","text":"改写后的提示词"}');
assert.equal(final.action, 'final');
assert.equal(final.text, '改写后的提示词');

// 没有 action 但给了 text：按最终处理
const loose = parseAction('{"text":"裸文本结果"}');
assert.equal(loose.action, 'final');

// 完全不是 JSON：整段当改写结果，不炸
const plain = parseAction('直接给一段中文。');
assert.equal(plain.action, 'final');
assert.equal(plain.text, '直接给一段中文。');

// 包了代码围栏也能解
assert.equal(parseAction('```json\n{"action":"final","text":"甲"}\n```').text, '甲');

// ask 但没有任何有效问句：退化成 final，不能凭空造问
assert.equal(parseAction('{"action":"ask","questions":[]}').action, 'final');

// 问答记录：缺字段丢弃，超量保留最近 12 条
assert.equal(normalizeHistory([{ question: 'q' }, { answer: 'a' }]).length, 0);
assert.equal(normalizeHistory('nope').length, 0);
const long = Array.from({ length: 20 }, (_, i) => ({ question: 'q' + i, answer: 'a' + i }));
const kept = normalizeHistory(long);
assert.equal(kept.length, 12);
assert.equal(kept[11].question, 'q19');

// 整段复读仍然收成一份
assert.equal(collapseRepeat('甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸'), '甲乙丙丁戊己庚辛壬癸');

console.log('all assertions passed');

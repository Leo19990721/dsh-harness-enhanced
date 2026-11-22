import assert from 'node:assert/strict';
import test from 'node:test';
import { inputBudget, estimatedInput, trimToolContent, choosePrefix } from '../compaction-policy.js';

const routed = (provider, model, window, maxTokens) => inputBudget({ provider, model, window, maxTokens });

test('Codex uses the prepared route window without reserving an unsent output cap', () => {
  const astra = { budget: 258_400, threshold: 244_800, pruneTarget: 193_800, target: 155_040 };
  assert.deepEqual(routed('codex', 'gpt-astra', 272_000, 128_000), astra);
  assert.deepEqual(routed('codex', '~account:fixture:gpt-astra', 272_000, 128_000), astra);
  assert.deepEqual(routed('codex', 'fixture-account-pool', 272_000, 128_000), astra);
  assert.deepEqual(routed('codex', 'gpt-sol', 500_000, 128_000),
    { budget: 475_000, threshold: 450_000, pruneTarget: 356_250, target: 285_000 });
});

test('native DeepSeek and relays consume their own shared input/output window', () => {
  for (const provider of ['deepseek-account', 'deepseek-official']) {
    for (const model of ['deepseek-v4-pro', 'deepseek-v4-flash']) {
      assert.deepEqual(routed(provider, model, 1_048_576, 256_000),
        { budget: 792_576, threshold: 752_947, pruneTarget: 594_432, target: 475_545 });
    }
  }
  assert.deepEqual(routed('company-epai', 'deepseek', 262_144, 65_536),
    { budget: 196_608, threshold: 186_777, pruneTarget: 147_456, target: 117_964 });
});

test('only verified Gemini routes use an independent input budget', () => {
  const independent = { budget: 1_048_576, threshold: 943_718, pruneTarget: 786_432, target: 629_145 };
  assert.deepEqual(routed('google', 'gemini-2.5-pro', 1_048_576, 65_536), independent);
  assert.deepEqual(routed('google-vertex', 'gemini-3-pro-preview', 1_048_576, 65_536), independent);
  assert.equal(routed('google', 'gemini-4-argon', 512_000, 65_536).budget, 446_464);
  assert.equal(routed('antigravity', 'gemini-2.5-pro', 512_000, 65_536).budget, 446_464);
  assert.equal(routed('relay', 'gemini-2.5-pro', 512_000, 65_536).budget, 446_464);
});

test('invalid capacities get a configuration diagnostic instead of a default guess', () => {
  for (const value of [undefined, 0, -10, NaN, Infinity, 1.5]) {
    assert.match(routed('codex', 'gpt-astra', value, 128_000).problem, /contextWindow/);
  }
  assert.match(routed('relay', 'model', 100_000, 100_000).problem, /maxTokens/);
  assert.match(routed('relay', 'model', 100_000, -1).problem, /maxTokens/);
});

test('cache reads and writes count as input; previous output does not', () => {
  const usage = { inputTokens: 30_000, cacheReadTokens: 65_000, cacheWriteTokens: 9_000, outputTokens: 100_000, totalTokens: 204_000 };
  assert.equal(estimatedInput(103_000, { usage, heuristic: 100_000 }), 107_000);
  assert.equal(estimatedInput(103_000, { usage, heuristic: 111_000 }), 103_000);
});

test('tool trims leave small text untouched, retaining Unicode edges and middle file locators', () => {
  assert.equal(trimToolContent([{ type: 'text', text: 'short' }]), null);
  const image = { type: 'image', attachment: { attachmentId: 'fixture' } };
  const file = 'D:\\example workspace\\report.txt';
  const spill = 'D:\\spill store\\result.txt';
  const content = [
    { type: 'text', text: `HEAD:${'😀'.repeat(4200)}\n<path>${file}</path>` },
    image,
    { type: 'text', text: `Full formatted result stored at: ${spill}. Use read with offset/limit.\n${'😀'.repeat(5400)}:TAIL` },
  ];
  const retained = trimToolContent(content);
  const output = retained.filter(block => block.type === 'text').map(block => block.text).join('');
  assert.equal(retained.includes(image), true);
  assert.equal(output.isWellFormed(), true);
  assert.equal(output.startsWith('HEAD:'), true);
  assert.equal(output.endsWith(':TAIL'), true);
  for (const value of [file, spill]) assert.ok(output.includes(value));
  assert.ok(output.length < content[0].text.length + content[2].text.length);
});

test('summary plans use surface order, keep tool pairs together and respect the separate summary budget', () => {
  const rows = [310, 21, 24, 28, 42].map((seq, i) => ({ seq, tokens: [0, 60_000, 10_000, 36_000, 140_000][i] }));
  const options = { start: 1, stop: 4, total: 246_000, target: 155_040, ceiling: 244_799,
    minimumGain: 0, summaryBudget: 120_000, auxiliaryBase: 400, warmRows: rows, warmThrough: 0,
    balancedAfter: seq => seq !== 24 };
  assert.deepEqual(choosePrefix(rows, options), { start: 21, end: 28 });
  assert.deepEqual(choosePrefix(rows, { ...options, summaryBudget: 100_000 }), { start: 21, end: 21 });
  assert.equal(choosePrefix(rows, { ...options, summaryBudget: 60_000 }), undefined);
});

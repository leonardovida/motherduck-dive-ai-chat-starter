// The admin Activity tab's one-line summary of an audit entry's detail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDetail, showValue } from '../src/admin/activity-detail.mjs';

test('prints plain values, lists and nested objects as text', () => {
  assert.equal(describeDetail({ dives: ['overview', 'sales'], chat: true, rows: 0 }), 'dives: overview, sales · chat: true · rows: 0');
  assert.equal(describeDetail({ tiers: { luna: 'openai:gpt-5-mini', sol: 'anthropic:claude' } }), 'tiers: luna openai:gpt-5-mini, sol anthropic:claude');
  assert.equal(describeDetail({ dives: [], tiers: {} }), 'dives: — · tiers: —');
});

test('never prints [object Object], however deep the value', () => {
  const text = describeDetail({ failed: [{ grantee: 'svc', url: 'md:_share/x' }], nested: [[1, 2], [3]], deep: { a: { b: [{ c: null }] } } });
  assert.doesNotMatch(text, /\[object Object\]/);
  assert.equal(text, 'failed: grantee svc, url md:_share/x · nested: 1, 2, 3 · deep: a b c —');
});

test('skips empty top-level values and tolerates missing or odd details', () => {
  assert.equal(describeDetail({ group: null, role: undefined, note: '', manager: false }), 'manager: false');
  for (const detail of [null, undefined, 'text', 42]) assert.equal(describeDetail(detail), '');
  for (const value of [null, undefined, '']) assert.equal(showValue(value), '—');
  assert.equal(showValue([null, 'a']), '—, a');
});

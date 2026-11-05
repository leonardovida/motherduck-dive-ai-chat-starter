// The activity log: details are stored as JSON that always parses, a bad row cannot fail the
// whole list, and the person search treats % and _ as plain characters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditLog } from '../lib/audit.mjs';

function fakeQuery(rows = []) {
  const calls = [];
  const query = async (text, values = []) => { calls.push({ text, values }); return text.startsWith('SELECT') ? rows : []; };
  return { calls, query };
}
const actor = { id: 'admin-1', username: 'admin' };

test('a detail too long to keep is stored as a note that still parses', async () => {
  const { calls, query } = fakeQuery();
  const log = createAuditLog(query);
  await log.record(actor, 'group.updated', { id: 'g1', label: 'Acme' }, { dives: Array.from({ length: 300 }, (_, i) => `dive-number-${i}`) });
  await log.record(actor, 'group.updated', { id: 'g1', label: 'Acme' }, { dives: ['overview'] });
  const [long, short] = calls.filter(call => call.text.startsWith('INSERT INTO audit_event')).map(call => call.values[7]);
  assert.deepEqual(JSON.parse(long), { detail: 'too long to keep' });
  assert.deepEqual(JSON.parse(short), { dives: ['overview'] });
});

test('a stored detail that does not parse shows no detail instead of failing the list', async () => {
  const { query } = fakeQuery([
    { id: 'a', action: 'group.updated', detail: '{"dives":["over' },
    { id: 'b', action: 'group.updated', detail: '{"dives":["overview"]}' },
    { id: 'c', action: 'person.enabled', detail: null },
  ]);
  const events = await createAuditLog(query).list();
  assert.deepEqual(events.map(event => event.detail), [null, { dives: ['overview'] }, null]);
});

test('the person search matches % and _ literally', async () => {
  const { calls, query } = fakeQuery();
  await createAuditLog(query).list({ q: 'Jo_Doe%' });
  const select = calls.find(call => call.text.startsWith('SELECT'));
  assert.equal(select.values[0], '%jo\\_doe\\%%');
  assert.match(select.text, /LIKE \$1 ESCAPE '\\' OR lower\(target_label\) LIKE \$1 ESCAPE '\\'/);
});

// Snapshot codec: delta entries decode back to the quantized state, interest bands and lag-comp delay.
import { test } from 'node:test';
import assert from 'node:assert';
import { NFIELDS, quantize, encodeEntry, createSnapshotDecoder, bandFor, extraDelay, POS_Q } from '../shared/netcodec.js';
import { Match } from '../server/match.js';

test('delta entries round-trip through the decoder', () => {
  const dec = createSnapshotDecoder();
  let last = null;
  let x = 431.27, z = -250.5, yaw = 3.1;
  for (let i = 0; i < 200; i++) {
    x += Math.sin(i) * 0.4; z += 0.3; yaw += 0.21;                  // yaw wraps past +PI many times
    const cur = quantize(x, i % 7 === 0 ? 2.5 : 0, z, yaw, Math.sin(i) * 1.4, i % 5, 17, i % 3 ? 0 : 4, i & 3, new Int32Array(NFIELDS));
    cur[9] = i < 100 ? 1 : 4;
    const parts = [];
    const upd = encodeEntry(42, cur, last, parts);
    if (upd) last = upd;
    const m = JSON.parse('{"ps":[' + parts.join(',') + ']}');
    const out = dec(m);
    if (!parts.length) continue;
    const e = out[0];
    assert.equal(e.id, 42);
    assert.ok(Math.abs(e.x - x) <= 0.5 / POS_Q + 1e-9, 'x');
    assert.ok(Math.abs(e.z - z) <= 0.5 / POS_Q + 1e-9, 'z');
    const dy = Math.atan2(Math.sin(e.yaw - yaw), Math.cos(e.yaw - yaw));
    assert.ok(Math.abs(dy) < 0.01, 'yaw');
    assert.equal(e.ph, i % 5); assert.equal(e.em, i % 3 ? 0 : 4); assert.equal(e.fl, i & 3);
    assert.equal(e.every, i < 100 ? 1 : 4);
  }
  // unchanged state sends nothing
  const parts = [];
  assert.equal(encodeEntry(42, last.slice(), last, parts), null);
  assert.equal(parts.length, 0);
  // forgetting a player resets it; deltas for unknown players are ignored until a keyframe arrives
  dec({ ps: [], pg: [42] });
  assert.equal(dec.known.has(42), false);
  const moved = last.slice(); moved[0] += 30;
  const p2 = [];
  encodeEntry(42, moved, last, p2);
  assert.equal(dec(JSON.parse('{"ps":[' + p2.join(',') + ']}')).length, 0);
  const p3 = [];
  encodeEntry(42, moved, last, p3, true);
  const back = dec(JSON.parse('{"ps":[' + p3.join(',') + ']}'));
  assert.equal(back.length, 1);
  assert.equal(Math.round(back[0].x * POS_Q), moved[0]);
});

test('interest bands have hysteresis and matching lag-comp delay', () => {
  assert.equal(bandFor(50, 0), 1);
  assert.equal(bandFor(125, 1), 1);       // stays fine just past the edge
  assert.equal(bandFor(125, 0), 2);
  assert.equal(bandFor(115, 2), 2);       // needs to come clearly closer to go back
  assert.equal(bandFor(105, 2), 1);
  assert.equal(bandFor(1000, 1), 4);
  assert.equal(extraDelay(1, 20), 0);
  assert.ok(Math.abs(extraDelay(4, 20) - 0.15) < 1e-9);
});

test('server sends far players less often and forgets dead ones', () => {
  const m = new Match({ code: 'T', mode: 'nobuild' });
  clearInterval(m.timer);
  const msgs = [];
  const human = m.addHuman({ readyState: 1, send: (s) => msgs.push(JSON.parse(s)) }, 'VIEWER', null);
  m.start();
  const others = [...m.players.values()].filter((p) => p !== human).slice(0, 3);
  for (const p of [...m.players.values()]) { p.phase = 'dead'; p.alive = false; }
  for (const p of [human, ...others]) { p.alive = true; p.phase = 'ground'; p.hp = 100; p.y = 0; }
  human.x = 0; human.z = 0;
  others[0].x = 20; others[0].z = 0;     // near
  others[1].x = 400; others[1].z = 0;    // far
  others[2].x = 0; others[2].z = 30;     // near, will die
  const dec = createSnapshotDecoder();
  const seen = new Map();
  for (let i = 0; i < 40; i++) {
    for (const p of others) p.x += 0.3;  // everyone keeps moving
    if (i === 20) { others[2].alive = false; others[2].phase = 'dead'; }
    msgs.length = 0;
    m.sendSnapshots(100 + i / 20);
    const s = msgs.find((x) => x.t === 's');
    for (const e of dec(s)) seen.set(e.id, (seen.get(e.id) || 0) + 1);
    if (i === 20) assert.deepEqual(s.pg, [others[2].id]);
  }
  assert.equal(seen.get(others[0].id), 40);
  assert.ok(seen.get(others[1].id) <= 11 && seen.get(others[1].id) >= 9, 'far player ~every 4th tick: ' + seen.get(others[1].id));
  assert.equal(seen.get(others[2].id), 20);
  assert.equal(m.netDelay(human, others[1]), 0.15);
  assert.equal(m.netDelay(human, others[0]), 0);
  m.close();
});

// Compact, JSON-compatible encoding of the player list in snapshots (`s.ps`).
//
// Every client keeps, per remote player, the last state it was sent. WebSockets are reliable and
// ordered, so the server only sends the fields that changed since the previous entry it sent to
// that client, and position/yaw/pitch are sent as small integer deltas.
//
// Entry: [k, ...fields]   k = id * 2048 + mask   (mask bit i set => field i follows, in order)
//   0 x   1 y   2 z    position, delta in 1/50 m units
//   3 yaw    delta in 1/1024 turns, wrapped to [-512, 512)
//   4 pitch  delta in 1/100 rad
//   5 ph  6 w  7 em  8 fl   absolute (phase code, held item code, emote, flags)
//   9 every  update interval in ticks the server uses for this player (interest band, see NET)
//   bit 10 KEY: keyframe, all 10 fields follow as absolute values. Sent for new players and every
//   KEY_TICKS per player as a safety net, so a client can never drift.
// `s.pg` = ids of players the client should forget (dead, left, or back in the blimp).
// Players that did not change, or that are not due this tick (far away), are simply left out:
// the client holds their last state.

export const POS_Q = 50;          // 2 cm
export const YAW_Q = 1024;        // 0.35 degrees
export const PITCH_Q = 100;
export const NFIELDS = 10;
export const KEY = 1024;
export const KEY_TICKS = 100;     // 5 s at 20 Hz
const TAU = Math.PI * 2;

// Interest management: how often (in ticks) a player's state is sent, by horizontal distance.
// Squad mates are always sent every tick. `hyst` avoids flapping at the borders.
export const NET = {
  bands: [{ d: 120, every: 1 }, { d: 260, every: 2 }, { d: Infinity, every: 4 }],
  hyst: 10,
};
// Extra interpolation delay (seconds) a client uses for a player sent every `every` ticks.
// The server rewinds hit detection by the same amount, so lag compensation stays exact.
export const extraDelay = (every, tickRate) => (every - 1) / tickRate;

export function bandFor(dist, prevEvery) {
  const B = NET.bands;
  for (let i = 0; i < B.length; i++) {
    let lim = B[i].d;
    if (prevEvery && B[i].every === prevEvery) lim += NET.hyst;      // stay until clearly past the edge
    else if (prevEvery && B[i].every < prevEvery) lim -= NET.hyst;   // come clearly closer to go finer
    if (dist < lim) return B[i].every;
  }
  return B[B.length - 1].every;
}

// Quantize a player into `out` (Int32Array(NFIELDS)); field 9 (`every`) is filled in by the caller.
export function quantize(x, y, z, yaw, pitch, ph, w, em, fl, out) {
  out[0] = Math.round(x * POS_Q); out[1] = Math.round(y * POS_Q); out[2] = Math.round(z * POS_Q);
  let a = Math.round((yaw / TAU) * YAW_Q) % YAW_Q; if (a < 0) a += YAW_Q;
  out[3] = a; out[4] = Math.round(pitch * PITCH_Q);
  out[5] = ph; out[6] = w; out[7] = em; out[8] = fl;
  return out;
}

// Append the entry for `cur` to `parts`: a keyframe when `last` is null or `key` is set, otherwise
// the changed fields relative to `last`. Returns the client's new last state (a new array when
// `last` was null), or null when nothing changed and nothing was written.
export function encodeEntry(id, cur, last, parts, key = false) {
  if (!last || key) {
    parts.push('[' + (id * 2048 + KEY + 1023) + ',' + cur.join(',') + ']');
    if (!last) last = new Int32Array(NFIELDS);
    last.set(cur);
    return last;
  }
  let mask = 0, s = '';
  for (let i = 0; i < NFIELDS; i++) {
    if (cur[i] === last[i]) continue;
    let v;
    if (i <= 2 || i === 4) v = cur[i] - last[i];
    else if (i === 3) { v = (cur[i] - last[i]) % YAW_Q; if (v >= YAW_Q / 2) v -= YAW_Q; else if (v < -YAW_Q / 2) v += YAW_Q; }
    else v = cur[i];
    mask |= 1 << i;
    s += ',' + v;
  }
  if (!mask) return null;
  parts.push('[' + (id * 2048 + mask) + s + ']');
  last.set(cur);
  return last;
}

// Client side. Returns decode(snapshot) -> array of { id, x, y, z, yaw, pitch, ph, w, em, fl, every }
// for the players present in this snapshot; also forgets players listed in `pg`.
export function createSnapshotDecoder() {
  const known = new Map();
  const decode = (m) => {
    const out = [];
    if (m.pg) for (const id of m.pg) known.delete(id);
    for (const e of m.ps || []) {
      const k = e[0], id = Math.floor(k / 2048), mask = k % 2048, key = mask & KEY;
      let st = known.get(id);
      if (!st) {
        if (!key) continue;   // delta for a player we never got a keyframe for: wait for the next one
        st = new Int32Array(NFIELDS); known.set(id, st);
      }
      let j = 1;
      for (let i = 0; i < NFIELDS; i++) {
        if (!(mask & (1 << i))) continue;
        const v = e[j++];
        if (key) st[i] = v;
        else if (i <= 2 || i === 4) st[i] += v;
        else if (i === 3) st[i] = (((st[i] + v) % YAW_Q) + YAW_Q) % YAW_Q;
        else st[i] = v;
      }
      out.push({
        id, x: st[0] / POS_Q, y: st[1] / POS_Q, z: st[2] / POS_Q, yaw: (st[3] / YAW_Q) * TAU, pitch: st[4] / PITCH_Q,
        ph: st[5], w: st[6], em: st[7], fl: st[8], every: st[9] || 1,
      });
    }
    return out;
  };
  decode.known = known;
  return decode;
}

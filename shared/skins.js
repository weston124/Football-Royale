// Original team skins. "unlock" says what you need to wear it.
export const SKIN_PRESETS = [
  { id: 'llamas',   team: 'Lava Llamas',      jersey: '#e2471f', accent: '#ffd23f', helmet: '#e2471f', stripe: '#ffd23f', mask: '#222222', pants: '#ffffff' },
  { id: 'narwhals', team: 'Neon Narwhals',    jersey: '#14d1c4', accent: '#ff3fa4', helmet: '#1d1f3a', stripe: '#14d1c4', mask: '#ff3fa4', pants: '#1d1f3a' },
  { id: 'coyotes',  team: 'Cosmic Coyotes',   jersey: '#4b2a8c', accent: '#f2c14e', helmet: '#4b2a8c', stripe: '#f2c14e', mask: '#c0c0c0', pants: '#f2c14e' },
  { id: 'toads',    team: 'Thunder Toads',    jersey: '#4cae3c', accent: '#1b3a1b', helmet: '#f7e04a', stripe: '#1b3a1b', mask: '#1b3a1b', pants: '#ffffff' },
  { id: 'moose',    team: 'Midnight Moose',   jersey: '#1a2340', accent: '#9fb4ff', helmet: '#1a2340', stripe: '#9fb4ff', mask: '#9fb4ff', pants: '#9fb4ff' },
  { id: 'gophers',  team: 'Gold Rush Gophers',jersey: '#8a5a2b', accent: '#ffcf33', helmet: '#ffcf33', stripe: '#8a5a2b', mask: '#8a5a2b', pants: '#ffcf33', unlock: { kills: 10 } },
  { id: 'pirates',  team: 'Ice Pirates',      jersey: '#dff3ff', accent: '#2a7bd6', helmet: '#2a7bd6', stripe: '#ffffff', mask: '#0d2440', pants: '#2a7bd6', unlock: { wins: 1 } },
  { id: 'rhinos',   team: 'Robo Rhinos',      jersey: '#7a8088', accent: '#ff2e2e', helmet: '#3a3f45', stripe: '#ff2e2e', mask: '#ff2e2e', pants: '#3a3f45', unlock: { wins: 3 } },
  { id: 'galaxy',   team: 'Galaxy Gladiators',jersey: '#0b0b2a', accent: '#ff7bf2', helmet: '#0b0b2a', stripe: '#6df7ff', mask: '#ffffff', pants: '#0b0b2a', unlock: { kills: 50 } },
];

export const EMOTES = [
  { id: 1, name: 'Gridiron Shuffle', dur: 4.0, loop: true },
  { id: 2, name: 'Touchdown Spike',  dur: 2.2 },
  { id: 3, name: 'Victory Dance',    dur: 4.0, loop: true },
  { id: 4, name: 'Helmet Salute',    dur: 2.0 },
  { id: 5, name: 'Ref Signals',      dur: 3.2, loop: true },
];

const HEX = /^#[0-9a-f]{6}$/i;
export function sanitizeSkin(s) {
  const base = SKIN_PRESETS[0];
  const out = { preset: base.id };
  if (s && typeof s === 'object') {
    const p = SKIN_PRESETS.find((x) => x.id === s.preset) || base;
    out.preset = p.id;
    for (const k of ['jersey', 'accent', 'helmet', 'stripe', 'mask', 'pants']) {
      out[k] = HEX.test(s[k]) ? s[k] : p[k];
    }
    const n = parseInt(s.number, 10);
    out.number = Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : 12;
  } else {
    Object.assign(out, base, { number: 12 });
  }
  return out;
}

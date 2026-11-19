// Graphics quality presets + dynamic resolution.
//
// API for the settings menu (also on window.__fr.quality):
//   setQuality('auto' | 'low' | 'medium' | 'high')   saved in localStorage 'fr_quality'
//   getQuality()          -> the saved setting ('auto' by default)
//   getQualityInfo()      -> { setting, level (the preset in use), scale (resolution scale), fps, target }
//   onQualityChange(fn)   -> fn(info) whenever the preset in use changes; returns an unsubscribe function
// 'auto' starts from a guess based on the device and steps down if a match runs below the target fps.
// Every preset also scales the render resolution down (to 50%) when the frame rate drops.
import { setCharacterQuality } from './human.js';

export const PRESETS = {
  low: {
    pixelRatio: 0.85, minScale: 0.5, fullMax: 2, fullDist: 14, midMax: 14, midDist: 55, farDist: 260,
    lootDist: 40, chestDist: 90, tagDist: 120, fogFar: 380, camFar: 700, animEvery: 2,
  },
  medium: {
    pixelRatio: 1.0, minScale: 0.55, fullMax: 5, fullDist: 24, midMax: 26, midDist: 85, farDist: 380,
    lootDist: 55, chestDist: 120, tagDist: 160, fogFar: 520, camFar: 1200, animEvery: 2,
  },
  high: {
    pixelRatio: 1.5, minScale: 0.6, fullMax: 8, fullDist: 35, midMax: 40, midDist: 130, farDist: 450,
    lootDist: 70, chestDist: 150, tagDist: 200, fogFar: 650, camFar: 2000, animEvery: 1,
  },
};
const LEVELS = ['low', 'medium', 'high'];
const KEY = 'fr_quality', AUTO_KEY = 'fr_quality_auto';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isTouchMac = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
export const isMobile = /Android|iPhone|iPad|iPod|Mobile|CrOS/i.test(ua) || isTouchMac;

let renderer = null, gpu = '';
let setting = LEVELS.includes(store.get(KEY)) || store.get(KEY) === 'auto' ? store.get(KEY) : 'auto';
let level = 'medium';
let scale = 1;
const listeners = new Set();
const stats = { fps: 60, frames: 0, acc: 0, lowFor: 0, okFor: 0, sinceChange: 0, playTime: 0 };

function guessLevel() {
  const saved = store.get(AUTO_KEY);
  if (LEVELS.includes(saved)) return saved;
  const g = gpu.toLowerCase();
  const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 4;
  if (/swiftshader|llvmpipe|software|mali|adreno [1-5]|powervr|videocore/.test(g)) return 'low';
  if (/CrOS|Android/i.test(ua) || mem <= 4 || cores <= 2) return 'low';
  if (isMobile || /intel/.test(g) || cores <= 4) return 'medium';
  return 'high';
}
export const targetFps = () => (isMobile ? 30 : 60);

function apply() {
  const P = PRESETS[level];
  setCharacterQuality(level);
  if (renderer) {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const pr = Math.max(0.35, Math.min(dpr, P.pixelRatio) * scale);
    if (Math.abs(renderer.getPixelRatio() - pr) > 0.01) renderer.setPixelRatio(pr);
  }
  const info = getQualityInfo();
  for (const fn of listeners) fn(info);
}

export function attachRenderer(r) {
  renderer = r;
  try {
    const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch { gpu = ''; }
  level = setting === 'auto' ? guessLevel() : setting;
  scale = 1;
  apply();
}
export function setQuality(lv) {
  if (lv !== 'auto' && !LEVELS.includes(lv)) return getQualityInfo();
  setting = lv;
  store.set(KEY, lv);
  level = lv === 'auto' ? guessLevel() : lv;
  scale = 1; stats.lowFor = stats.okFor = stats.sinceChange = 0;
  apply();
  return getQualityInfo();
}
export const getQuality = () => setting;
export const getSettings = () => PRESETS[level];
export function getQualityInfo() {
  return { setting, level, scale: +scale.toFixed(2), fps: Math.round(stats.fps), target: targetFps(), gpu };
}
export function onQualityChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Call once per rendered frame (in a match) with the frame time in seconds.
export function frameTick(dt) {
  if (!(dt > 0) || dt > 1) return;
  stats.acc += dt; stats.frames++; stats.sinceChange += dt; stats.playTime += dt;
  if (stats.acc < 1) return;
  stats.fps = stats.frames / stats.acc;
  const sec = stats.acc;
  stats.acc = 0; stats.frames = 0;
  const target = targetFps(), P = PRESETS[level];
  if (stats.fps < target * 0.88) { stats.lowFor += sec; stats.okFor = 0; } else if (stats.fps >= target * 0.97) { stats.okFor += sec; stats.lowFor = 0; } else { stats.lowFor = stats.okFor = 0; }
  // dynamic resolution: drop quickly, recover slowly
  if (stats.lowFor >= 2 && scale > P.minScale) {
    scale = Math.max(P.minScale, scale * 0.85); stats.lowFor = 0; stats.sinceChange = 0; apply();
  } else if (stats.okFor >= 5 && scale < 1 && stats.sinceChange > 5) {
    scale = Math.min(1, scale + 0.1); stats.okFor = 0; stats.sinceChange = 0; apply();
  } else if (setting === 'auto' && stats.lowFor >= 4 && scale <= P.minScale + 1e-6 && stats.playTime > 8) {
    // still too slow at the lowest resolution: step the preset down and remember it for next time
    const i = LEVELS.indexOf(level);
    if (i > 0) {
      level = LEVELS[i - 1]; scale = 0.8; stats.lowFor = 0; stats.sinceChange = 0;
      store.set(AUTO_KEY, level); apply();
    }
  }
}

if (typeof window !== 'undefined') {
  window.__fr = Object.assign(window.__fr || {}, {
    quality: { setQuality, getQuality, info: getQualityInfo, onChange: onQualityChange, presets: PRESETS },
  });
}

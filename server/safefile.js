// Crash-safe JSON files for player data.
// - writes go to a temp file, are fsync'ed, then atomically renamed over the real file,
//   so a crash or power cut leaves either the old file or the new one, never half a file
// - rolling backups (<file>.bak-1 newest ... .bak-N oldest), at most one new backup per interval
// - a corrupt file is never overwritten: it is kept as <file>.corrupt-<time>, the newest good
//   backup is loaded instead (or we start clean) and the problem is logged loudly
import fs from 'node:fs';
import path from 'node:path';

const BACKUPS = 5;
const BACKUP_EVERY_MS = 60 * 60 * 1000; // one new backup per hour while data changes

function fsyncDir(dir) {
  // makes the rename itself durable (not supported on every platform, so best effort)
  let fd;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); } catch { /* ignore */ } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

export function writeFileAtomic(file, text, mode = 0o600) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
  fs.closeSync(fd);
  fs.renameSync(tmp, file);
  fsyncDir(dir);
}

const bak = (file, i) => `${file}.bak-${i}`;

function loud(msg) {
  const line = '!'.repeat(78);
  console.error(`\n${line}\n!!! DATA WARNING: ${msg}\n${line}\n`);
}

// Loads JSON from `file`. Returns { data, source } where source is 'file', 'backup', 'new' or 'corrupt'.
export function loadJson(file, { validate = (d) => d && typeof d === 'object' } = {}) {
  const parse = (f) => {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!validate(d)) throw new Error('unexpected shape');
    return d;
  };
  if (!fs.existsSync(file)) {
    // the file is missing; if backups exist something went wrong (deleted by hand?), so use one
    for (let i = 1; i <= BACKUPS; i++) {
      if (!fs.existsSync(bak(file, i))) continue;
      try { const d = parse(bak(file, i)); loud(`${file} is missing but ${bak(file, i)} exists. Loaded the backup.`); return { data: d, source: 'backup' }; } catch { /* try older */ }
    }
    return { data: null, source: 'new' };
  }
  try {
    return { data: parse(file), source: 'file' };
  } catch (e) {
    const kept = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try { fs.renameSync(file, kept); } catch { try { fs.copyFileSync(file, kept); } catch { /* ignore */ } }
    for (let i = 1; i <= BACKUPS; i++) {
      try {
        const d = parse(bak(file, i));
        loud(`${file} could not be read (${e.message}). The bad file was kept as ${kept}. Restored from ${bak(file, i)}.`);
        return { data: d, source: 'backup' };
      } catch { /* try older */ }
    }
    loud(`${file} could not be read (${e.message}). The bad file was kept as ${kept}. No good backup found: STARTING WITH EMPTY DATA.`);
    return { data: null, source: 'corrupt' };
  }
}

// A JSON store with throttled, atomic saves and rolling backups.
// get() returns the object to save; call save() after changes, flush() to write now.
export function jsonStore(file, get, { delay = 500, mode = 0o600, pretty = false } = {}) {
  let timer = null, lastBackup = 0, dirty = false;
  function backup() {
    if (!fs.existsSync(file) || Date.now() - lastBackup < BACKUP_EVERY_MS) return;
    lastBackup = Date.now();
    try {
      for (let i = BACKUPS - 1; i >= 1; i--) if (fs.existsSync(bak(file, i))) fs.renameSync(bak(file, i), bak(file, i + 1));
      fs.copyFileSync(file, bak(file, 1));
    } catch (e) { console.error(`backup of ${file} failed:`, e.message); }
  }
  function flush() {
    clearTimeout(timer); timer = null;
    if (!dirty) return true;
    try {
      backup();
      writeFileAtomic(file, JSON.stringify(get(), null, pretty ? 2 : 0), mode);
      dirty = false;
      return true;
    } catch (e) {
      console.error(`SAVE FAILED for ${file}:`, e.message, '(will retry)');
      timer = setTimeout(flush, 5000); // keep the data in memory and try again
      return false;
    }
  }
  return {
    // throttled: the first change starts the timer and later changes ride along,
    // so a busy server still saves at least every `delay` ms
    save() { dirty = true; if (!timer) timer = setTimeout(flush, delay); },
    flush,
    get dirty() { return dirty; },
  };
}

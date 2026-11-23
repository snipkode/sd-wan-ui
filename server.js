const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const UI_TOKEN = process.env.UI_TOKEN || '';
const OUT_DIR = path.resolve(process.env.OUT_DIR || '/root/out');
const MODEL_DIR = path.resolve(process.env.MODEL_DIR || '/root/models/wan');
const OUT_HOST_DIR = String(process.env.OUT_HOST_DIR || '').trim() || OUT_DIR;
const MODEL_HOST_DIR = String(process.env.MODEL_HOST_DIR || '').trim() || MODEL_DIR;
const IMAGE = process.env.SD_IMAGE || 'sd-cpu:local';
const RUNNER = String(process.env.SD_RUNNER || 'docker').trim().toLowerCase() === 'local' ? 'local' : 'docker';
const RUNNER_LABEL = RUNNER === 'local' ? 'sd-cli' : 'docker';
const SD_CLI_BIN = process.env.SD_CLI_BIN || '/sd.cpp/bin/sd-cli';
const BACKEND_ENV = String(process.env.SD_BACKEND || 'cpu').trim() || 'cpu';
const PARAMS_BACKEND = String(process.env.SD_PARAMS_BACKEND || '').trim();
const MAX_VRAM = String(process.env.SD_MAX_VRAM || '').trim();
const CPU_THREADS = String(process.env.SD_THREADS || '').trim();
const GPU_DEVICES = String(process.env.GPU_DEVICES || 'all').trim() || 'all';
const VULKAN_DEVICE = String(process.env.VULKAN_DEVICE || '/dev/dri').trim() || '/dev/dri';
const EXTRA_ARGS = parseCliArgs(process.env.SD_EXTRA_ARGS || '');
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const KEEP_AVI = process.env.KEEP_AVI === '1';
const INPUT_DIR = path.resolve(process.env.INPUT_DIR || path.join(__dirname, 'input'));
const INPUT_HOST_DIR = String(process.env.INPUT_HOST_DIR || '').trim() || INPUT_DIR;
const INPAINT_MODEL_DIR = path.resolve(process.env.INPAINT_MODEL_DIR || '/root/models/inpaint');
const INPAINT_MODEL_HOST_DIR = String(process.env.INPAINT_MODEL_HOST_DIR || '').trim() || INPAINT_MODEL_DIR;
const INPAINT_MODEL_NAME = String(process.env.INPAINT_MODEL_NAME || 'stable-diffusion-v1-5-inpainting-Q4_0.gguf').replace(/[^a-zA-Z0-9._-]/g, '');
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const STATE_FILE = path.resolve(process.env.STATE_FILE || path.join(__dirname, 'state.json'));
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
const PUBLIC_DIR = path.join(__dirname, 'public');
const BOOT = Date.now();
const VIDEO_FPS = 16;
function oomError() {
  return `${RUNNER_LABEL} exit 137: OOM/killed, turunkan frame/resolusi/step atau tambah RAM/swap`;
}
const ACTIVE_JOB_STATUSES = ['starting', 'running', 'decoding', 'encoding', 'stopping'];
const PIPELINE_STAGES = ['input', 'text', 'sampling', 'vae', 'video', 'output'];

function framesForDuration(seconds) {
  const target = Math.round(seconds * VIDEO_FPS);
  return Math.max(1, 1 + Math.round((target - 1) / 4) * 4);
}

function parseCliArgs(value) {
  const parts = String(value).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return parts.map((part) => part.replace(/^(["'])(.*)\1$/, '$2'));
}

function detectGpuDevice() {
  if (RUNNER !== 'local') return '';
  try {
    const probe = spawnSync(SD_CLI_BIN, ['--list-devices'], { encoding: 'utf8', timeout: 20000 });
    const devices = String(probe.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.split('\t')[0].trim())
      .filter(Boolean);
    return devices.find((name) => /^cuda/i.test(name)) || devices.find((name) => /^vulkan/i.test(name)) || '';
  } catch {
    return '';
  }
}

const AUTO_BACKEND = BACKEND_ENV.toLowerCase() === 'auto';
const BACKEND = AUTO_BACKEND ? detectGpuDevice() || 'cpu' : BACKEND_ENV;

function normalizedBackend() {
  const value = String(BACKEND).trim() || 'cpu';
  if (value.includes('=')) return value;
  const lowered = value.toLowerCase();
  if (lowered === 'cuda') return 'cuda0';
  if (lowered === 'vulkan') return 'vulkan0';
  return lowered;
}

function backendCliArgs() {
  const args = ['--backend', normalizedBackend()];
  if (PARAMS_BACKEND) args.push('--params-backend', PARAMS_BACKEND);
  if (MAX_VRAM) args.push('--max-vram', MAX_VRAM);
  if (CPU_THREADS) args.push('-t', CPU_THREADS);
  return args;
}

function parseMultipart(buffer, boundary) {
  const result = { fields: Object.create(null), files: Object.create(null) };
  const delimiter = Buffer.from(`--${boundary}`);
  let pos = buffer.indexOf(delimiter);
  if (pos < 0) throw new Error('format upload tidak dikenali');
  while (pos >= 0) {
    pos += delimiter.length;
    if (buffer.slice(pos, pos + 2).toString() === '--') break;
    if (buffer.slice(pos, pos + 2).toString() === '\r\n') pos += 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', pos);
    if (headerEnd < 0) throw new Error('header upload tidak lengkap');
    const headers = buffer.slice(pos, headerEnd).toString('utf8');
    const disposition = headers.match(/^content-disposition:\s*form-data;([^\r\n]*)/im);
    const name = disposition && disposition[1].match(/\bname="([^"]*)"/i);
    const next = buffer.indexOf(delimiter, headerEnd + 4);
    if (next < 0) throw new Error('body upload tidak lengkap');
    if (disposition && name && name[1]) {
      const filename = disposition[1].match(/\bfilename="([^"]*)"/i);
      let contentEnd = next;
      if (buffer[contentEnd - 2] === 13 && buffer[contentEnd - 1] === 10) contentEnd -= 2;
      const data = buffer.subarray(headerEnd + 4, contentEnd);
      if (filename && filename[1]) {
        const type = headers.match(/^content-type:\s*([^\r\n]+)/im);
        result.files[name[1]] = {
          filename: filename[1],
          contentType: type ? type[1].trim() : 'application/octet-stream',
          data
        };
      } else {
        result.fields[name[1]] = data.toString('utf8');
      }
    }
    pos = next;
  }
  return result;
}

function readUpload(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error('upload terlalu besar, maksimal 16MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function maskBox(width, height, fields) {
  const left = clampNumber(fields.left, 0, 90, 25);
  const top = clampNumber(fields.top, 0, 90, 30);
  const right = clampNumber(fields.right, left + 5, 100, 75);
  const bottom = clampNumber(fields.bottom, top + 5, 100, 95);
  const x = Math.round((width * left) / 100);
  const y = Math.round((height * top) / 100);
  return {
    left,
    top,
    right,
    bottom,
    x,
    y,
    w: Math.min(width - x, Math.max(16, Math.round((width * (right - left)) / 100))),
    h: Math.min(height - y, Math.max(16, Math.round((height * (bottom - top)) / 100)))
  };
}

function dockerDeviceArgs() {
  const value = `${normalizedBackend()} ${PARAMS_BACKEND}`.toLowerCase();
  if (!value.includes('cuda') && !value.includes('vulkan')) return [];
  const args = [];
  if (value.includes('cuda')) args.push('--gpus', GPU_DEVICES);
  if (value.includes('vulkan')) args.push('--device', VULKAN_DEVICE);
  return args;
}

function terminateJob(target) {
  const proc = target && target.proc;
  if (!proc || proc.exitCode !== null) return;
  if (RUNNER === 'local' && process.platform !== 'win32' && proc.pid) {
    try {
      process.kill(-proc.pid, 'SIGTERM');
      return;
    } catch {
      proc.kill('SIGTERM');
      return;
    }
  }
  proc.kill('SIGTERM');
}

const QUALITY_PRESETS = {
  low: { label: 'Low', steps: 4, width: 320, height: 256, cfg: 6 },
  medium: { label: 'Medium', steps: 10, width: 512, height: 320, cfg: 6 },
  high: { label: 'High', steps: 20, width: 640, height: 400, cfg: 6 }
};

const DURATION_PRESETS = [10, 15, 25, 30, 60].map((seconds) => {
  const frames = framesForDuration(seconds);
  return { seconds, frames, actualSeconds: Number((frames / VIDEO_FPS).toFixed(3)) };
});

const MAX_FRAMES = Math.max(...DURATION_PRESETS.map((d) => d.frames));
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
};

const clients = new Set();
const genHits = new Map();
let job = null;
let seq = 0;

function now() {
  return new Date().toISOString();
}

function send(res, code, body, type = 'application/json') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    ...SEC_HEADERS,
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function checkAuth(req, res) {
  if (!UI_TOKEN) return true;
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Basic ')) {
    const raw = Buffer.from(header.slice(6), 'base64').toString();
    const i = raw.indexOf(':');
    if (i >= 0 && raw.slice(0, i) === 'sd' && raw.slice(i + 1) === UI_TOKEN) return true;
  }
  const payload = JSON.stringify({ error: 'unauthorized' });
  res.writeHead(401, {
    ...SEC_HEADERS,
    'WWW-Authenticate': 'Basic realm="sd-ui"',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
  return false;
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try {
      c.write(msg);
    } catch {
      clients.delete(c);
    }
  }
}

function safeName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && !name.includes('..');
}

function contentType(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.avi') return 'video/x-msvideo';
  if (ext === '.mov') return 'video/quicktime';
  return 'application/octet-stream';
}

function metaFile(name) {
  return path.join(OUT_DIR, `${name}.json`);
}

function readMeta(name) {
  if (!safeName(name)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(metaFile(name), 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function writeMeta(name, meta) {
  if (!safeName(name)) return;
  try {
    fs.writeFileSync(metaFile(name), JSON.stringify(meta, null, 2));
  } catch (err) {
    console.error(`metadata ${name}: ${err.message}`);
  }
}

function listFiles() {
  return fs.readdirSync(OUT_DIR)
    .filter(safeName)
    .map((name) => {
      const st = fs.statSync(path.join(OUT_DIR, name));
      const meta = readMeta(name);
      return { name, size: st.size, mtime: st.mtime.toISOString(), type: /\.(mp4|webm|mov|avi)$/i.test(name) ? 'video' : 'image', ...(meta ? { meta } : {}) };
    })
    .filter((f) => /\.(png|jpe?g|webp|mp4|webm|mov|avi)$/i.test(f.name))
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

function fileCounts() {
  const files = listFiles();
  return {
    all: files.length,
    image: files.filter((f) => f.type === 'image').length,
    video: files.filter((f) => f.type === 'video').length
  };
}

function filePage(pageValue, limitValue, typeValue) {
  const all = listFiles();
  const type = typeValue === 'image' || typeValue === 'video' ? typeValue : 'all';
  const filtered = type === 'all' ? all : all.filter((f) => f.type === type);
  const limit = clampInt(limitValue, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / limit));
  const page = Math.min(pages, Math.max(1, clampInt(pageValue, 1, pages, 1)));
  const start = (page - 1) * limit;
  return {
    files: filtered.slice(start, start + limit),
    page,
    pages,
    limit,
    total: filtered.length,
    counts: fileCounts(),
    hasPrev: page > 1,
    hasNext: page < pages
  };
}

function jobDurationMs(value) {
  const started = Date.parse(value && value.startedAt);
  const finished = Date.parse(value && value.finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : null;
}

function advanceStage(value, stage) {
  if (!value) return false;
  const next = PIPELINE_STAGES.indexOf(stage);
  const current = PIPELINE_STAGES.indexOf(value.stage || 'input');
  if (next < 0 || next <= current) return false;
  value.stage = stage;
  saveState();
  broadcast('status', { job: publicJob() });
  return true;
}

function emitLog(value, line) {
  broadcast('log', { jobId: value && value.id, line, progress: value && value.progress, stage: value && value.stage });
}

function publicJob() {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: jobDurationMs(job),
    exitCode: job.exitCode,
    stage: job.stage || null,
    progress: job.progress,
    logs: job.logs.slice(-300),
    output: job.output,
    prompt: job.prompt,
    frames: job.frames,
    kind: job.kind || 'wan',
    source: job.source || null,
    mask: job.mask || null,
    strength: job.strength || null,
    error: job.error,
    warning: job.warning,
    cancelled: Boolean(job.cancelled),
    canRetry: Boolean(job.config) && !ACTIVE_JOB_STATUSES.includes(job.status)
  };
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    seq = Number(s.seq) || 0;
    if (s.job) {
      const j = { ...s.job, proc: null, container: null };
      j.logs = Array.isArray(j.logs) ? j.logs : [];
      j.progress = j.progress || { current: 0, total: 0, percent: 0 };
      j.warning = j.warning || null;
      j.stage = j.stage || (j.status === 'done' ? 'output' : 'input');
      if (ACTIVE_JOB_STATUSES.includes(j.status)) {
        if (j.cancelled) {
          j.status = 'stopped';
          j.warning = j.warning || 'dihentikan oleh user';
          j.error = null;
        } else {
          j.status = 'error';
          j.error = 'server restarted while job was running';
        }
        j.finishedAt = j.finishedAt || now();
      }
      if (j.exitCode === 137 && /^(docker|sd-cli) exit 137/.test(String(j.error || ''))) j.error = oomError();
      j.config = j.config && typeof j.config === 'object' ? j.config : null;
      job = j;
    }
  } catch {
    job = null;
  }
}

function saveState() {
  try {
    const persisted = job ? { ...publicJob(), config: job.config || null } : null;
    const payload = JSON.stringify({ seq, job: persisted }, null, 2);
    fs.writeFileSync(`${STATE_FILE}.tmp`, payload);
    fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
  } catch (err) {
    console.error(now(), 'state save failed:', err.message);
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 16384) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function rateLimited(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const t = Date.now();
  const hits = (genHits.get(ip) || []).filter((x) => t - x < 60000);
  hits.push(t);
  genHits.set(ip, hits);
  return hits.length > 10;
}

function handleOutput(j, buf) {
  const text = buf.toString('utf8').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  for (const raw of text.split(/[\r\n]+/)) {
    const line = raw.trim();
    if (!line) continue;

    j.logs.push(line);
    if (j.logs.length > 400) j.logs.shift();

    const m = line.match(/(\d+)\s*\/\s*(\d+)\s*-\s*[\d.]+s\/it/);
    if (m) {
      const current = Number(m[1]);
      const total = Number(m[2]);
      if (total > 0 && (current !== j.progress.current || total !== j.progress.total)) {
        j.progress = { current, total, percent: Math.round((current / total) * 100) };
        advanceStage(j, 'sampling');
        broadcast('progress', { jobId: j.id, progress: j.progress });
        saveState();
      }
    }

    if (line.startsWith('[E]') || /\berror\b/i.test(line)) j.error = line;
    if (line.includes('get_learned_condition')) advanceStage(j, 'text');

    const sm = line.match(/save result[^']*'([^']+)'/);
    if (sm) {
      j.output = path.basename(sm[1]);
      if (j.frames === 1) advanceStage(j, 'output');
    }

    if (line.includes('generate_video completed') && j.status !== 'decoding') {
      j.status = 'decoding';
      advanceStage(j, 'vae');
      broadcast('status', { job: publicJob() });
      saveState();
    }

    const interesting =
      line.startsWith('[I]') ||
      line.startsWith('[W]') ||
      line.startsWith('[E]') ||
      m ||
      sm ||
      line.includes('generate_video completed') ||
      line.includes('get_learned_condition');

    if (interesting) emitLog(j, line);
  }
}

function transcodeToMp4(aviName, mp4Name) {
  return new Promise((resolve) => {
    const src = path.join(OUT_DIR, aviName);
    const dst = path.join(OUT_DIR, mp4Name);
    if (!fs.existsSync(src)) return resolve(false);

    const ff = spawn(FFMPEG_BIN, [
      '-y', '-loglevel', 'error',
      '-i', src,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-crf', '23',
      dst
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    ff.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    ff.on('error', () => resolve(false));
    ff.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(dst) || fs.statSync(dst).size === 0) return resolve(false);
      if (!KEEP_AVI) {
        try {
          fs.unlinkSync(src);
        } catch {
          resolve(true);
          return;
        }
      }
      resolve(true);
    });
  });
}

function runFfmpeg(args) {
  return new Promise((resolve) => {
    const ff = spawn(FFMPEG_BIN, ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    ff.on('error', () => resolve({ ok: false, error: 'ffmpeg tidak tersedia' }));
    ff.on('close', (code) => resolve({ ok: code === 0, error: stderr.trim() }));
  });
}

async function prepareOutfitFiles(config, id) {
  const extension = config.image.filename.toLowerCase().match(/\.(jpe?g|png|webp)$/)?.[1] || 'png';
  const uploaded = path.join(INPUT_DIR, `${id}-upload.${extension}`);
  const sourceName = `${id}-source.png`;
  const maskName = `${id}-mask.png`;
  fs.writeFileSync(uploaded, config.image.data);
  const box = maskBox(config.width, config.height, config.mask);
  try {
    const sourceFilter = `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    const source = await runFfmpeg(['-i', uploaded, '-vf', sourceFilter, '-frames:v', '1', path.join(INPUT_DIR, sourceName)]);
    if (!source.ok || !fs.existsSync(path.join(INPUT_DIR, sourceName))) throw new Error(source.error || 'gagal menyiapkan foto sumber');
    const maskFilter = `drawbox=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:color=white:t=fill,setsar=1`;
    const mask = await runFfmpeg([
      '-f', 'lavfi', '-i', `color=c=black:s=${config.width}x${config.height}`,
      '-vf', maskFilter, '-frames:v', '1', '-pix_fmt', 'gray', path.join(INPUT_DIR, maskName)
    ]);
    if (!mask.ok || !fs.existsSync(path.join(INPUT_DIR, maskName))) throw new Error(mask.error || 'gagal membuat mask');
    return { sourceName, maskName, box };
  } finally {
    try {
      fs.unlinkSync(uploaded);
    } catch {}
  }
}

function startInpaintJob(config, prepared) {
  const n = ++seq;
  const id = `f${Date.now()}-${n}`;
  const outputName = `outfit-${Date.now()}-${n}.png`;
  const inputBase = RUNNER === 'local' ? INPUT_DIR : '/input';
  const modelBase = RUNNER === 'local' ? INPAINT_MODEL_DIR : '/inpaint';
  const outputBase = RUNNER === 'local' ? OUT_DIR : '/output';
  const outputPath = path.join(outputBase, outputName);
  const container = `sd-ui-outfit-${id}`.replace(/[^A-Za-z0-9_.-]/g, '-');

  job = {
    id,
    kind: 'outfit',
    status: 'starting',
    stage: 'input',
    startedAt: now(),
    finishedAt: null,
    exitCode: null,
    progress: { current: 0, total: config.steps, percent: 0 },
    logs: [],
    output: outputName,
    prompt: config.prompt,
    frames: 1,
    source: prepared.sourceName,
    mask: prepared.maskName,
    strength: config.strength,
    error: null,
    warning: null,
    cancelled: false,
    proc: null,
    container,
    config: { kind: 'outfit', prompt: config.prompt, negative: config.negative, steps: config.steps, width: config.width, height: config.height, cfg: config.cfg, strength: config.strength, mask: prepared.box, sourceName: prepared.sourceName, maskName: prepared.maskName }
  };
  saveState();

  const sdArgs = [
    ...backendCliArgs(),
    '-M', 'img_gen',
    '--model', path.join(modelBase, INPAINT_MODEL_NAME),
    '-i', path.join(inputBase, prepared.sourceName),
    '--mask', path.join(inputBase, prepared.maskName),
    '-p', config.prompt,
    '-n', config.negative,
    '--cfg-scale', config.cfg.toFixed(1),
    '--sampling-method', 'euler',
    '--steps', String(config.steps),
    '-W', String(config.width),
    '-H', String(config.height),
    '--strength', config.strength.toFixed(2),
    '--vae-tiling',
    '-o', outputPath,
    '-v',
    ...EXTRA_ARGS
  ];

  const proc = RUNNER === 'local'
    ? spawn(SD_CLI_BIN, sdArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    : spawn('docker', [
        'run', '--rm', '--name', container,
        ...dockerDeviceArgs(),
        '-v', `${INPAINT_MODEL_HOST_DIR}:/inpaint:ro`,
        '-v', `${INPUT_HOST_DIR}:/input:ro`,
        '-v', `${OUT_HOST_DIR}:/output`,
        IMAGE,
        ...sdArgs
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
  job.proc = proc;
  job.status = 'running';
  job.stage = 'text';
  broadcast('status', { job: publicJob() });
  saveState();

  proc.stdout.on('data', (d) => handleOutput(job, d));
  proc.stderr.on('data', (d) => handleOutput(job, d));

  proc.on('error', (err) => {
    if (job && job.cancelled) return;
    job.error = String(err.message || err);
    job.status = 'error';
    job.finishedAt = now();
    broadcast('status', { job: publicJob() });
    emitLog(job, job.error);
    saveState();
  });

  proc.on('close', (code) => {
    if (!job || job.id !== id) return;
    job.exitCode = code;
    job.finishedAt = now();
    if (job.cancelled) {
      job.status = 'stopped';
      job.error = null;
      job.warning = 'dihentikan oleh user · tidak ada output akhir';
      const line = `job ${id} dihentikan · ${RUNNER_LABEL} exit ${code}`;
      job.logs.push(line);
      if (job.logs.length > 400) job.logs.shift();
      emitLog(job, line);
    } else {
      if (code !== 0 && !job.error) {
        job.error = code === 137 ? oomError() : `${RUNNER_LABEL} exit ${code}`;
        if (code === 137) emitLog(job, job.error);
      }
      job.status = code === 0 ? 'done' : 'error';
      if (code === 0) advanceStage(job, 'output');
    }
    if (code === 0) {
      const meta = {
        kind: 'outfit',
        prompt: config.prompt,
        negative: config.negative,
        frames: 1,
        steps: config.steps,
        width: config.width,
        height: config.height,
        cfg: config.cfg,
        strength: config.strength,
        source: prepared.sourceName,
        mask: prepared.maskName,
        maskBox: prepared.box,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        durationMs: jobDurationMs(job),
        status: job.status,
        warning: job.warning || null
      };
      if (fs.existsSync(path.join(OUT_DIR, outputName))) writeMeta(outputName, { ...meta, output: outputName });
    }
    knownFiles = new Set(listFiles().map((f) => f.name));
    broadcast('status', { job: publicJob() });
    broadcast('files', { counts: fileCounts() });
    saveState();
  });

  return publicJob();
}

function startJob(config) {
  const n = ++seq;
  const id = `j${Date.now()}-${n}`;
  const baseName = `wan-${Date.now()}-${n}`;
  const outputName = `${baseName}.${config.frames > 1 ? 'avi' : 'png'}`;
  const finalName = config.frames > 1 ? `${baseName}.mp4` : outputName;
  const modelBase = RUNNER === 'local' ? MODEL_DIR : '/models';
  const outputBase = RUNNER === 'local' ? OUT_DIR : '/output';
  const outputPath = path.join(outputBase, outputName);
  const container = `sd-ui-${id}`.replace(/[^A-Za-z0-9_.-]/g, '-');

  job = {
    id,
    status: 'starting',
    stage: 'input',
    startedAt: now(),
    finishedAt: null,
    exitCode: null,
    progress: { current: 0, total: config.steps, percent: 0 },
    logs: [],
    output: outputName,
    prompt: config.prompt,
    frames: config.frames,
    error: null,
    warning: null,
    cancelled: false,
    proc: null,
    container,
    config: { kind: 'generate', prompt: config.prompt, negative: config.negative, frames: config.frames, steps: config.steps, width: config.width, height: config.height, cfg: config.cfg }
  };
  saveState();

  const sdArgs = [
    ...backendCliArgs(),
    '-M', 'vid_gen',
    '--diffusion-model', path.join(modelBase, 'wan2.1_t2v_1.3b-q4_k_m.gguf'),
    '--taesd', path.join(modelBase, 'taew2_1.safetensors'),
    '--t5xxl', path.join(modelBase, 'umt5-xxl-encoder-Q3_K_S.gguf'),
    '-p', config.prompt,
    '-n', config.negative,
    '--cfg-scale', config.cfg.toFixed(1),
    '--sampling-method', 'euler',
    '--flow-shift', '3.0',
    '--steps', String(config.steps),
    '-W', String(config.width),
    '-H', String(config.height),
    '--video-frames', String(config.frames),
    '-o', outputPath,
    '-v',
    ...EXTRA_ARGS
  ];

  const proc = RUNNER === 'local'
    ? spawn(SD_CLI_BIN, sdArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    : spawn('docker', [
        'run', '--rm', '--name', container,
        ...dockerDeviceArgs(),
        '-v', `${MODEL_HOST_DIR}:/models:ro`,
        '-v', `${OUT_HOST_DIR}:/output`,
        IMAGE,
        ...sdArgs
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
  job.proc = proc;
  job.status = 'running';
  job.stage = 'text';
  broadcast('status', { job: publicJob() });
  saveState();

  proc.stdout.on('data', (d) => handleOutput(job, d));
  proc.stderr.on('data', (d) => handleOutput(job, d));

  proc.on('error', (err) => {
    if (job && job.cancelled) return;
    job.error = String(err.message || err);
    job.status = 'error';
    job.finishedAt = now();
    broadcast('status', { job: publicJob() });
    emitLog(job, job.error);
    saveState();
  });

  proc.on('close', async (code) => {
    if (!job || job.id !== id) return;
    job.exitCode = code;
    job.finishedAt = now();
    if (job.cancelled) {
      job.status = 'stopped';
      job.error = null;
      job.warning = 'dihentikan oleh user · tidak ada output akhir';
      const line = `job ${id} dihentikan · ${RUNNER_LABEL} exit ${code}`;
      job.logs.push(line);
      if (job.logs.length > 400) job.logs.shift();
      emitLog(job, line);
    } else {
      if (code !== 0 && !job.error) {
        job.error = code === 137 ? oomError() : `${RUNNER_LABEL} exit ${code}`;
        if (code === 137) emitLog(job, job.error);
      }

      if (code === 0 && config.frames > 1) {
        job.status = 'encoding';
        advanceStage(job, 'video');
        broadcast('status', { job: publicJob() });
        const nativeName = path.basename(job.output || outputName);
        const ok = await transcodeToMp4(nativeName, finalName);
        if (ok) {
          job.output = finalName;
          advanceStage(job, 'output');
          emitLog(job, `video converted to ${finalName}`);
        } else {
          job.warning = `ffmpeg gagal; video AVI asli tetap ${nativeName}`;
          advanceStage(job, 'output');
          emitLog(job, job.warning);
        }
      }

      job.status = code === 0 ? 'done' : 'error';
      if (code === 0) advanceStage(job, 'output');
    }
    if (code === 0) {
      const meta = {
        prompt: config.prompt,
        negative: config.negative,
        frames: config.frames,
        videoSeconds: config.frames > 1 ? Number(((config.frames - 1) / 16).toFixed(2)) : null,
        steps: config.steps,
        width: config.width,
        height: config.height,
        cfg: config.cfg,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        durationMs: jobDurationMs(job),
        status: job.status,
        warning: job.warning || null
      };
      const outputs = new Set([job.output, outputName].filter(Boolean));
      for (const name of outputs) {
        if (fs.existsSync(path.join(OUT_DIR, name))) writeMeta(name, { ...meta, output: name });
      }
    }
    knownFiles = new Set(listFiles().map((f) => f.name));
    broadcast('status', { job: publicJob() });
    broadcast('files', { counts: fileCounts() });
    saveState();
  });

  return publicJob();
}

function cancelJob() {
  if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) return null;
  if (job.cancelled) return publicJob();

  const active = job;
  active.cancelled = true;
  active.status = 'stopping';
  active.error = null;
  active.warning = 'menghentikan job…';
  const line = `stop requested · ${active.id}`;
  active.logs.push(line);
  if (active.logs.length > 400) active.logs.shift();
  broadcast('status', { job: publicJob() });
  emitLog(active, line);
  saveState();

  if (RUNNER === 'docker' && active.container) {
    const stop = spawn('docker', ['stop', '--time', '3', active.container], { stdio: 'ignore' });
    stop.on('error', () => terminateJob(active));
    stop.on('close', (code) => {
      if (code !== 0) terminateJob(active);
    });
  } else {
    terminateJob(active);
  }

  return publicJob();
}

function deleteAsset(name) {
  if (!safeName(name)) return { error: 'nama file tidak valid', code: 400 };
  const file = path.join(OUT_DIR, name);
  if (path.dirname(file) !== OUT_DIR) return { error: 'nama file tidak valid', code: 400 };
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { error: 'file tidak ditemukan', code: 404 };
  if (job && ACTIVE_JOB_STATUSES.includes(job.status) && job.output === name) {
    return { error: 'file sedang dipakai job aktif', code: 409 };
  }

  const base = name.replace(/\.(mp4|avi)$/i, '');
  const candidates = /\.(mp4|avi)$/i.test(name) ? [name, `${base}.mp4`, `${base}.avi`] : [name];
  let removed = 0;
  for (const candidate of candidates) {
    if (!safeName(candidate)) continue;
    const target = path.join(OUT_DIR, candidate);
    if (path.dirname(target) !== OUT_DIR || !fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    try {
      fs.unlinkSync(target);
      const metaTarget = metaFile(candidate);
      if (fs.existsSync(metaTarget)) fs.unlinkSync(metaTarget);
      removed += 1;
    } catch {
      return { error: `gagal menghapus ${candidate}`, code: 500 };
    }
  }

  knownFiles = new Set(listFiles().map((f) => f.name));
  broadcast('files', { counts: fileCounts() });
  return { ok: true, removed };
}

async function handleDelete(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch (err) {
    return send(res, 400, { error: `invalid JSON: ${err.message}` });
  }

  const result = deleteAsset(String(body.name || ''));
  if (result.error) return send(res, result.code, { error: result.error });
  return send(res, 200, result);
}

async function handleGenerate(req, res) {
  if (rateLimited(req)) return send(res, 429, { error: 'terlalu banyak request, coba lagi sebentar' });

  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch (err) {
    return send(res, 400, { error: `invalid JSON: ${err.message}` });
  }

  if (job && ACTIVE_JOB_STATUSES.includes(job.status)) {
    return send(res, 409, { error: 'inference masih berjalan', job: publicJob() });
  }

  const prompt = String(body.prompt || 'a lovely cat walking in neon rain, cinematic').trim().slice(0, 500) || 'a lovely cat';
  const negative = String(body.negative || 'blurry, low quality, watermark, text').trim().slice(0, 500);
  const frames = clampInt(body.frames, 1, MAX_FRAMES, 1);
  const steps = clampInt(body.steps, 1, 50, 10);
  const width = clampInt(body.width, 256, 1024, 512);
  const height = clampInt(body.height, 256, 1024, 320);
  const cfg = clampNum(body.cfg, 0, 20, 6);

  if (width % 16 || height % 16) {
    return send(res, 400, { error: 'width dan height harus kelipatan 16' });
  }

  const created = startJob({ prompt, negative, frames, steps, width, height, cfg });
  return send(res, 200, { job: created });
}

async function handleOutfit(req, res) {
  if (rateLimited(req)) return send(res, 429, { error: 'terlalu banyak request, coba lagi sebentar' });
  if (job && ACTIVE_JOB_STATUSES.includes(job.status)) {
    return send(res, 409, { error: 'inference masih berjalan', job: publicJob() });
  }

  const contentType = String(req.headers['content-type'] || '');
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!contentType.toLowerCase().startsWith('multipart/form-data') || !boundary) {
    return send(res, 400, { error: 'kirim outfit swap sebagai multipart/form-data' });
  }

  let form;
  try {
    form = parseMultipart(await readUpload(req), String(boundary[1] || boundary[2] || '').trim());
  } catch (err) {
    return send(res, 400, { error: `upload gagal: ${err.message}` });
  }

  const modelPath = path.join(RUNNER === 'local' ? INPAINT_MODEL_DIR : INPAINT_MODEL_HOST_DIR, INPAINT_MODEL_NAME);
  if (!fs.existsSync(modelPath)) {
    return send(res, 409, { error: `model inpainting belum tersedia: ${modelPath}. Jalankan scripts/download-inpaint-model.sh` });
  }

  const image = form.files.image;
  if (!image || !image.data.length) return send(res, 400, { error: 'foto karakter wajib diunggah' });
  const allowedImage = /^image\/(png|jpeg|webp)$/i.test(image.contentType) || /\.(png|jpe?g|webp)$/i.test(image.filename);
  if (!allowedImage) return send(res, 400, { error: 'format foto harus PNG, JPG, atau WEBP' });

  const fields = form.fields;
  const prompt = String(fields.prompt || 'a portrait, detailed outfit, consistent identity, natural lighting').trim().slice(0, 500)
    || 'a portrait, detailed outfit, consistent identity, natural lighting';
  const negative = String(fields.negative || 'blurry, low quality, watermark, text, deformed body').trim().slice(0, 500);
  const steps = clampInt(fields.steps, 1, 50, 20);
  const width = clampInt(fields.width, 256, 1024, 512);
  const height = clampInt(fields.height, 256, 1024, 640);
  const cfg = clampNum(fields.cfg, 0, 20, 6);
  const strength = clampNum(fields.strength, 0.3, 1, 0.95);
  if (width % 16 || height % 16) return send(res, 400, { error: 'width dan height harus kelipatan 16' });

  const config = {
    image,
    prompt,
    negative,
    steps,
    width,
    height,
    cfg,
    strength,
    mask: {
      left: fields.left,
      top: fields.top,
      right: fields.right,
      bottom: fields.bottom
    }
  };

  let prepared;
  try {
    prepared = await prepareOutfitFiles(config, `f${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  } catch (err) {
    return send(res, 400, { error: `gagal menyiapkan outfit: ${err.message}` });
  }

  const created = startInpaintJob(config, prepared);
  return send(res, 200, { job: created });
}

async function handleRetry(req, res) {
  if (rateLimited(req)) return send(res, 429, { error: 'terlalu banyak request, coba lagi sebentar' });
  if (job && ACTIVE_JOB_STATUSES.includes(job.status)) {
    return send(res, 409, { error: 'inference masih berjalan', job: publicJob() });
  }
  const cfg = job && job.config;
  if (!cfg || !cfg.kind) return send(res, 409, { error: 'tidak ada job untuk di-retry' });
  if (cfg.kind === 'outfit') {
    const sourcePath = path.join(INPUT_DIR, String(cfg.sourceName || ''));
    const maskPath = path.join(INPUT_DIR, String(cfg.maskName || ''));
    if (!safeName(cfg.sourceName) || !safeName(cfg.maskName) || !fs.existsSync(sourcePath) || !fs.existsSync(maskPath)) {
      return send(res, 409, { error: 'file source/mask outfit tidak tersedia, upload ulang dari form outfit' });
    }
    const modelPath = path.join(RUNNER === 'local' ? INPAINT_MODEL_DIR : INPAINT_MODEL_HOST_DIR, INPAINT_MODEL_NAME);
    if (!fs.existsSync(modelPath)) return send(res, 409, { error: `model inpainting belum tersedia: ${modelPath}` });
    const prepared = { sourceName: cfg.sourceName, maskName: cfg.maskName, box: cfg.mask || { left: 25, top: 30, right: 75, bottom: 95 } };
    const created = startInpaintJob({ prompt: cfg.prompt, negative: cfg.negative, steps: cfg.steps, width: cfg.width, height: cfg.height, cfg: cfg.cfg, strength: cfg.strength }, prepared);
    return send(res, 200, { job: created });
  }
  const created = startJob({
    prompt: String(cfg.prompt || '').slice(0, 500) || 'a lovely cat',
    negative: String(cfg.negative || '').slice(0, 500),
    frames: clampInt(cfg.frames, 1, MAX_FRAMES, 1),
    steps: clampInt(cfg.steps, 1, 50, 10),
    width: clampInt(cfg.width, 256, 1024, 512),
    height: clampInt(cfg.height, 256, 1024, 320),
    cfg: clampNum(cfg.cfg, 0, 20, 6)
  });
  return send(res, 200, { job: created });
}

async function handleRegenerate(req, res) {
  if (rateLimited(req)) return send(res, 429, { error: 'terlalu banyak request, coba lagi sebentar' });
  if (job && ACTIVE_JOB_STATUSES.includes(job.status)) {
    return send(res, 409, { error: 'inference masih berjalan', job: publicJob() });
  }
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch (err) {
    return send(res, 400, { error: `invalid JSON: ${err.message}` });
  }
  const name = String(body.name || '');
  if (!safeName(name)) return send(res, 400, { error: 'nama file tidak valid' });
  const meta = readMeta(name);
  if (!meta) return send(res, 404, { error: 'metadata tidak ditemukan untuk file ini' });
  if (meta.kind === 'outfit') {
    const sourceName = String(meta.source || '');
    const maskName = String(meta.mask || '');
    if (!safeName(sourceName) || !safeName(maskName) || !fs.existsSync(path.join(INPUT_DIR, sourceName)) || !fs.existsSync(path.join(INPUT_DIR, maskName))) {
      return send(res, 409, { error: 'source/mask outfit asli tidak tersedia; upload ulang dari form outfit' });
    }
    const modelPath = path.join(RUNNER === 'local' ? INPAINT_MODEL_DIR : INPAINT_MODEL_HOST_DIR, INPAINT_MODEL_NAME);
    if (!fs.existsSync(modelPath)) return send(res, 409, { error: `model inpainting belum tersedia: ${modelPath}` });
    const created = startInpaintJob({
      prompt: String(meta.prompt || '').slice(0, 500),
      negative: String(meta.negative || '').slice(0, 500),
      steps: clampInt(meta.steps, 1, 50, 20),
      width: clampInt(meta.width, 256, 1024, 512),
      height: clampInt(meta.height, 256, 1024, 640),
      cfg: clampNum(meta.cfg, 0, 20, 6),
      strength: clampNum(meta.strength, 0.3, 1, 0.95)
    }, { sourceName, maskName, box: meta.maskBox || { left: 25, top: 30, right: 75, bottom: 95 } });
    return send(res, 200, { job: created });
  }
  const created = startJob({
    prompt: String(meta.prompt || '').slice(0, 500) || 'a lovely cat',
    negative: String(meta.negative || '').slice(0, 500),
    frames: clampInt(meta.frames, 1, MAX_FRAMES, 1),
    steps: clampInt(meta.steps, 1, 50, 10),
    width: clampInt(meta.width, 256, 1024, 512),
    height: clampInt(meta.height, 256, 1024, 320),
    cfg: clampNum(meta.cfg, 0, 20, 6)
  });
  return send(res, 200, { job: created });
}

function handleStream(req, res) {
  res.writeHead(200, {
    ...SEC_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ job: publicJob(), counts: fileCounts(), time: now() })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(ping);
      clients.delete(res);
    }
  }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

function servePublic(res, pathname) {
  const allowed = {
    '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
    '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' }
  };
  const entry = allowed[pathname];
  if (!entry) return send(res, 404, { error: 'not found' });
  const file = path.join(PUBLIC_DIR, entry.file);
  try {
    const data = fs.readFileSync(file);
    return send(res, 200, data, entry.type);
  } catch {
    return send(res, 404, { error: 'not found' });
  }
}

function handleOut(req, res, pathname, download) {
  let name;
  try {
    name = decodeURIComponent(pathname.slice('/out/'.length));
  } catch {
    return send(res, 400, { error: 'bad name' });
  }
  if (!safeName(name)) return send(res, 400, { error: 'bad name' });
  const file = path.join(OUT_DIR, name);
  if (path.dirname(file) !== OUT_DIR) return send(res, 400, { error: 'bad name' });
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return send(res, 404, { error: 'not found' });
  }
  if (!st.isFile()) return send(res, 404, { error: 'not found' });

  const type = contentType(name);
  const disposition = download ? { 'Content-Disposition': `attachment; filename="${name}"` } : {};
  const range = String(req.headers.range || '');
  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (match) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : st.size - 1;
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start && start < st.size) {
      const safeEnd = Math.min(end, st.size - 1);
      res.writeHead(206, {
        ...SEC_HEADERS,
        'Content-Type': type,
        'Content-Length': safeEnd - start + 1,
        'Content-Range': `bytes ${start}-${safeEnd}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        ...disposition
      });
      fs.createReadStream(file, { start, end: safeEnd }).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    ...SEC_HEADERS,
    'Content-Type': type,
    'Content-Length': st.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ...disposition
  });
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

loadState();
let knownFiles = new Set(listFiles().map((f) => f.name));

setInterval(() => {
  const files = listFiles();
  const fresh = files.filter((f) => !knownFiles.has(f.name));
  if (fresh.length || files.length !== knownFiles.size) {
    knownFiles = new Set(files.map((f) => f.name));
    broadcast('files', { counts: fileCounts() });
    for (const f of fresh) broadcast('file', { file: f });
  }
}, 1000).unref();

const server = http.createServer(async (req, res) => {
  res.on('finish', () => console.log(`${now()} ${req.method} ${req.url} ${res.statusCode}`));

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return send(res, 400, { error: 'bad url' });
  }

  const p = url.pathname;
  if (p === '/api/health') {
    const current = publicJob();
    return send(res, 200, {
      ok: true,
      uptime: Math.round((Date.now() - BOOT) / 1000),
      auth: Boolean(UI_TOKEN),
      job: current ? current.status : null,
      backend: normalizedBackend(),
      backendSource: AUTO_BACKEND ? 'auto' : 'env',
      paramsBackend: PARAMS_BACKEND || null,
      maxVram: MAX_VRAM || null,
      threads: CPU_THREADS || null,
      runner: RUNNER,
      image: IMAGE,
      cli: SD_CLI_BIN,
      dockerDevices: dockerDeviceArgs(),
      backendArgs: backendCliArgs(),
      extraArgs: EXTRA_ARGS,
      hostMounts: { models: MODEL_HOST_DIR, output: OUT_HOST_DIR, input: INPUT_HOST_DIR, inpaint: INPAINT_MODEL_HOST_DIR }
    });
  }
  if (!checkAuth(req, res)) return;

  if (p === '/' || p === '/index.html') return servePublic(res, '/index.html');
  if (p === '/styles.css' || p === '/app.js') return servePublic(res, p);
  if (p === '/api/status') return send(res, 200, { job: publicJob(), counts: fileCounts() });
  if (p === '/api/files') return send(res, 200, filePage(url.searchParams.get('page'), url.searchParams.get('limit'), url.searchParams.get('type')));
  if (p === '/api/presets') return send(res, 200, {
    fps: VIDEO_FPS,
    maxFrames: MAX_FRAMES,
    durations: DURATION_PRESETS,
    qualities: QUALITY_PRESETS
  });
  if (p === '/api/stream') return handleStream(req, res);
  if (p === '/api/generate') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    return handleGenerate(req, res);
  }
  if (p === '/api/outfit') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    return handleOutfit(req, res);
  }
  if (p === '/api/cancel') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const stopped = cancelJob();
    if (!stopped) return send(res, 409, { error: 'tidak ada job aktif' });
    return send(res, 200, { job: stopped });
  }
  if (p === '/api/retry') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    return handleRetry(req, res);
  }
  if (p === '/api/regenerate') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    return handleRegenerate(req, res);
  }
  if (p === '/api/delete') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    return handleDelete(req, res);
  }
  if (p.startsWith('/out/')) return handleOut(req, res, p, url.searchParams.get('download') === '1');
  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`sd-ui listening on http://${HOST}:${PORT} auth=${UI_TOKEN ? 'on' : 'off'}`);
});

function shutdown() {
  if (job && job.proc && ACTIVE_JOB_STATUSES.includes(job.status)) {
    if (RUNNER === 'docker') spawn('docker', ['stop', job.container], { stdio: 'ignore' });
    else terminateJob(job);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

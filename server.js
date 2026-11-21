const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const UI_TOKEN = process.env.UI_TOKEN || '';
const OUT_DIR = path.resolve(process.env.OUT_DIR || '/root/out');
const MODEL_DIR = path.resolve(process.env.MODEL_DIR || '/root/models/wan');
const IMAGE = process.env.SD_IMAGE || 'sd-cpu:local';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const KEEP_AVI = process.env.KEEP_AVI === '1';
const STATE_FILE = path.join(__dirname, 'state.json');
fs.mkdirSync(OUT_DIR, { recursive: true });
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const BOOT = Date.now();
const VIDEO_FPS = 16;

function framesForDuration(seconds) {
  const target = Math.round(seconds * VIDEO_FPS);
  return Math.max(1, 1 + Math.round((target - 1) / 4) * 4);
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

function listFiles() {
  return fs.readdirSync(OUT_DIR)
    .filter(safeName)
    .map((name) => {
      const st = fs.statSync(path.join(OUT_DIR, name));
      return { name, size: st.size, mtime: st.mtime.toISOString(), type: /\.(mp4|webm|mov|avi)$/i.test(name) ? 'video' : 'image' };
    })
    .filter((f) => /\.(png|jpe?g|webp|mp4|webm|mov|avi)$/i.test(f.name))
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

function publicJob() {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    progress: job.progress,
    logs: job.logs.slice(-300),
    output: job.output,
    prompt: job.prompt,
    frames: job.frames,
    error: job.error,
    warning: job.warning
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
      if (['starting', 'running', 'decoding', 'encoding'].includes(j.status)) {
        j.status = 'error';
        j.error = 'server restarted while job was running';
        j.finishedAt = j.finishedAt || now();
      }
      job = j;
    }
  } catch {
    job = null;
  }
}

function saveState() {
  try {
    const payload = JSON.stringify({ seq, job: job ? publicJob() : null }, null, 2);
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
        broadcast('progress', { jobId: j.id, progress: j.progress });
        saveState();
      }
    }

    if (line.startsWith('[E]') || /\berror\b/i.test(line)) j.error = line;

    const sm = line.match(/save result[^']*'([^']+)'/);
    if (sm) j.output = path.basename(sm[1]);

    if (line.includes('generate_video completed') && j.status !== 'decoding') {
      j.status = 'decoding';
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

    if (interesting) broadcast('log', { jobId: j.id, line, progress: j.progress });
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

function startJob(config) {
  const n = ++seq;
  const id = `j${Date.now()}-${n}`;
  const baseName = `wan-${Date.now()}-${n}`;
  const outputName = `${baseName}.${config.frames > 1 ? 'avi' : 'png'}`;
  const finalName = config.frames > 1 ? `${baseName}.mp4` : outputName;
  const outputPath = `/output/${outputName}`;
  const container = `sd-ui-${id}`.replace(/[^A-Za-z0-9_.-]/g, '-');

  job = {
    id,
    status: 'starting',
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
    proc: null,
    container
  };
  saveState();

  const args = [
    'run', '--rm', '--name', container,
    '-v', `${MODEL_DIR}:/models:ro`,
    '-v', `${OUT_DIR}:/output`,
    IMAGE,
    '-M', 'vid_gen',
    '--diffusion-model', '/models/wan2.1_t2v_1.3b-q4_k_m.gguf',
    '--taesd', '/models/taew2_1.safetensors',
    '--t5xxl', '/models/umt5-xxl-encoder-Q3_K_S.gguf',
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
    '-v'
  ];

  const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  job.proc = proc;
  job.status = 'running';
  broadcast('status', { job: publicJob() });
  saveState();

  proc.stdout.on('data', (d) => handleOutput(job, d));
  proc.stderr.on('data', (d) => handleOutput(job, d));

  proc.on('error', (err) => {
    job.error = String(err.message || err);
    job.status = 'error';
    job.finishedAt = now();
    broadcast('status', { job: publicJob() });
    broadcast('log', { jobId: job.id, line: job.error, progress: job.progress });
    saveState();
  });

  proc.on('close', async (code) => {
    if (!job || job.id !== id) return;
    job.exitCode = code;
    job.finishedAt = now();
    if (code !== 0 && !job.error) job.error = `docker exit ${code}`;

    if (code === 0 && config.frames > 1) {
      job.status = 'encoding';
      broadcast('status', { job: publicJob() });
      const nativeName = path.basename(job.output || outputName);
      const ok = await transcodeToMp4(nativeName, finalName);
      if (ok) {
        job.output = finalName;
        broadcast('log', { jobId: job.id, line: `video converted to ${finalName}`, progress: job.progress });
      } else {
        job.warning = `ffmpeg gagal; video AVI asli tetap ${nativeName}`;
        broadcast('log', { jobId: job.id, line: job.warning, progress: job.progress });
      }
    }

    job.status = code === 0 ? 'done' : 'error';
    knownFiles = new Set(listFiles().map((f) => f.name));
    broadcast('status', { job: publicJob() });
    broadcast('files', { files: listFiles() });
    saveState();
  });

  return publicJob();
}

async function handleGenerate(req, res) {
  if (rateLimited(req)) return send(res, 429, { error: 'terlalu banyak request, coba lagi sebentar' });

  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch (err) {
    return send(res, 400, { error: `invalid JSON: ${err.message}` });
  }

  if (job && ['starting', 'running', 'decoding', 'encoding'].includes(job.status)) {
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

function handleStream(req, res) {
  res.writeHead(200, {
    ...SEC_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ job: publicJob(), files: listFiles(), time: now() })}\n\n`);
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

function handleOut(req, res, pathname) {
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
        'Cache-Control': 'no-store'
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
    'Cache-Control': 'no-store'
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
    broadcast('files', { files });
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
    return send(res, 200, {
      ok: true,
      uptime: Math.round((Date.now() - BOOT) / 1000),
      auth: Boolean(UI_TOKEN),
      job: publicJob() ? publicJob().status : null
    });
  }
  if (!checkAuth(req, res)) return;

  if (p === '/' || p === '/index.html') return send(res, 200, HTML, 'text/html; charset=utf-8');
  if (p === '/api/status') return send(res, 200, { job: publicJob(), files: listFiles() });
  if (p === '/api/files') return send(res, 200, { files: listFiles() });
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
  if (p.startsWith('/out/')) return handleOut(req, res, p);
  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`sd-ui listening on http://${HOST}:${PORT} auth=${UI_TOKEN ? 'on' : 'off'}`);
});

function shutdown() {
  if (job && job.proc && ['starting', 'running', 'decoding', 'encoding'].includes(job.status)) {
    spawn('docker', ['stop', job.container], { stdio: 'ignore' });
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

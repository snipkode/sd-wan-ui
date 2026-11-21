#!/usr/bin/env node
const https = require('https');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync(process.env.HOME + '/.docker/config.json', 'utf8'));
const auth = cfg.auths?.['https://index.docker.io/v1/']?.auth;
if (!auth) throw new Error('no docker auth');

const decoded = Buffer.from(auth, 'base64').toString();
const split = decoded.indexOf(':');
const username = decoded.slice(0, split);
const password = decoded.slice(split + 1);

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    if (body) req.end(body);
    else req.end();
  });
}

async function getHubToken() {
  const body = JSON.stringify({ username, password });
  const res = await request({
    host: 'hub.docker.com',
    path: '/v2/users/login/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'sd-wan-ui',
      Accept: 'application/json'
    }
  }, body);
  if (res.status !== 200) throw new Error('hub login HTTP ' + res.status);
  const token = JSON.parse(res.data).token;
  if (!token) throw new Error('no hub token');
  return token;
}

const docs = {
  'sd-wan-offline': {
    description: 'Full portable Wan 2.1 UI + offline models + pipeline guide. No model download needed.',
    full_description: [
      '# sd-wan-offline',
      '',
      'Full portable Docker image for **Wan 2.1 T2V 1.3B Q4_K_M** with the web UI, `sd-cli` CPU backend, ffmpeg, and the three Wan models bundled inside. No model download and no Docker socket are needed.',
      '',
      'The UI includes a **pipeline indicator** showing text encoder → diffusion → VAE → video encode → output, plus a single **Panduan cepat** popup explaining higher `steps` (more correction passes and usually better detail at the cost of time) and manual controls CFG, sampler, and negative prompt. ETA countdown and output metadata are also available.',
      '',
      'Size is about **4.15 GB compressed**, so the first pull can take a while.',
      '',
      '## Docker Compose',
      '',
      '```bash',
      'git clone https://github.com/snipkode/sd-wan-ui.git',
      'cd sd-wan-ui',
      'mkdir -p out runtime',
      'cp .env.compose.example .env',
      'docker compose -f docker-compose.offline.yml up -d',
      '```',
      '',
      '## Plain docker run',
      '',
      '```bash',
      'mkdir -p out runtime',
      'docker run -d --name sd-wan-offline --restart unless-stopped -p 3001:3001 \\',
      '  -v "$PWD/out:/output" \\',
      '  -v "$PWD/runtime:/app/runtime" \\',
      '  -e UI_TOKEN="${UI_TOKEN:-}" \\',
      '  snipkode/sd-wan-offline:latest',
      '```',
      '',
      'Open `http://<host>:3001`. Models are already at `/models` inside the image; only `./out` and `./runtime` need to be mounted.',
      '',
      'Set `UI_TOKEN` before exposing the UI to an untrusted network. Full documentation: https://github.com/snipkode/sd-wan-ui',
      ''
    ].join('\n')
  },
  'sd-wan': {
    description: 'All-in-one Wan 2.1 T2V UI + sd-cli + ffmpeg + pipeline guide.',
    full_description: [
      '# sd-wan',
      '',
      'All-in-one Docker image for **Wan 2.1 T2V 1.3B Q4_K_M** with a web UI, `sd-cli` CPU backend, and ffmpeg. Inference runs directly inside the container, so this image does **not** need `/var/run/docker.sock`.',
      '',
      'The UI now has a **pipeline indicator** before the log, tooltips for beginners, an ETA countdown, a Preset/Manual layout, and one popup guide explaining `steps` as correction passes plus CFG, sampler, and negative prompt for manual mode.',
      '',
      '## Docker Compose',
      '',
      '```bash',
      'git clone https://github.com/snipkode/sd-wan-ui.git',
      'cd sd-wan-ui',
      'mkdir -p models out runtime',
      'MODEL_DIR="$PWD/models" ./scripts/download-models.sh',
      'cp .env.compose.example .env',
      'docker compose -f docker-compose.all.yml up -d',
      '```',
      '',
      'Open `http://<host>:3001`. Change `UI_PORT` in `.env` if port 3001 is occupied.',
      '',
      '## Plain docker run',
      '',
      '```bash',
      'mkdir -p models out runtime',
      'MODEL_DIR="$PWD/models" ./scripts/download-models.sh',
      'docker run -d --name sd-wan --restart unless-stopped -p 3001:3001 \\',
      '  -v "$PWD/models:/models:ro" \\',
      '  -v "$PWD/out:/output" \\',
      '  -v "$PWD/runtime:/app/runtime" \\',
      '  -e UI_TOKEN="${UI_TOKEN:-}" \\',
      '  snipkode/sd-wan:latest',
      '```',
      '',
      '## Useful commands',
      '',
      '```bash',
      'curl http://127.0.0.1:3001/api/health',
      'docker logs -f sd-wan',
      'docker run --rm snipkode/sd-wan:latest sd --help',
      'docker stop sd-wan && docker rm sd-wan',
      '```',
      '',
      '## Notes',
      '',
      '- Models are not bundled because they are about 3.7 GB. Download them into `./models` first.',
      '- `./models` is mounted read-only to `/models`, `./out` to `/output`, and `./runtime` keeps `state.json`.',
      '- This image defaults to CPU. For CUDA/Vulkan, use the split setup with a GPU inference image.',
      '- Set `UI_TOKEN` before exposing the UI to an untrusted network.',
      '- Full documentation: https://github.com/snipkode/sd-wan-ui',
      ''
    ].join('\n')
  },
  'sd-wan-ui': {
    description: 'Web UI for sd-wan-ui split setup with pipeline guide and ETA.',
    full_description: [
      '# sd-wan-ui',
      '',
      'Web UI container for the split **sd-wan-ui** setup. It needs `snipkode/sd-wan-infer` as the inference image and mounts `/var/run/docker.sock` to launch inference containers.',
      '',
      'Included in this UI: pipeline stage indicator with model names, beginner tooltips, ETA countdown, Preset/Manual configuration, one popup guide for steps/CFG/sampler/negative prompt, and output metadata in the gallery.',
      '',
      'For a simpler single-container setup, use `snipkode/sd-wan` instead.',
      '',
      '```bash',
      'git clone https://github.com/snipkode/sd-wan-ui.git',
      'cd sd-wan-ui',
      'mkdir -p models out runtime',
      'MODEL_DIR="$PWD/models" ./scripts/download-models.sh',
      'cp .env.compose.example .env',
      'docker compose up -d',
      '```',
      '',
      'Open `http://<host>:3001`. Full documentation: https://github.com/snipkode/sd-wan-ui',
      ''
    ].join('\n')
  },
  'sd-wan-infer': {
    description: 'CPU sd-cli inference image for Wan 2.1 T2V with stable-diffusion.cpp.',
    full_description: [
      '# sd-wan-infer',
      '',
      'CPU inference image containing `sd-cli` from stable-diffusion.cpp release `master-1106-532d2c1` for Wan 2.1 T2V.',
      '',
      'Normally launched by `snipkode/sd-wan-ui` via Docker Compose. For a simpler single-container setup, use `snipkode/sd-wan`.',
      '',
      '```bash',
      'git clone https://github.com/snipkode/sd-wan-ui.git',
      'cd sd-wan-ui',
      'mkdir -p models out runtime',
      'MODEL_DIR="$PWD/models" ./scripts/download-models.sh',
      'cp .env.compose.example .env',
      'docker compose up -d',
      '```',
      '',
      'Full documentation: https://github.com/snipkode/sd-wan-ui',
      ''
    ].join('\n')
  }
};

async function patch(token, name, payload) {
  const body = JSON.stringify(payload);
  const res = await request({
    host: 'hub.docker.com',
    path: '/v2/repositories/snipkode/' + name + '/',
    method: 'PATCH',
    headers: {
      Authorization: 'JWT ' + token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'sd-wan-ui',
      Accept: 'application/json'
    }
  }, body);
  if (res.status >= 200 && res.status < 300) return name;
  throw new Error(name + ' HTTP ' + res.status + ': ' + res.data.slice(0, 300));
}

(async () => {
  const token = await getHubToken();
  for (const [name, payload] of Object.entries(docs)) {
    console.log('updated', await patch(token, name, payload));
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

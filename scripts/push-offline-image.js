#!/usr/bin/env node
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Transform, Writable } = require('stream');
const { pipeline } = require('stream/promises');
const { once } = require('events');

const cfg = JSON.parse(fs.readFileSync(process.env.HOME + '/.docker/config.json', 'utf8'));
const auth = cfg.auths?.['https://index.docker.io/v1/']?.auth;
if (!auth) throw new Error('no docker auth');

const decoded = Buffer.from(auth, 'base64').toString();
const split = decoded.indexOf(':');
const username = decoded.slice(0, split);
const password = decoded.slice(split + 1);

const SOURCE_REPO = 'snipkode/sd-wan';
const TARGET_REPO = 'snipkode/sd-wan-offline';
const TARGET_NAME = 'sd-wan-offline';
const TAG = 'latest';
const MODEL_DIR = path.resolve(process.env.MODEL_DIR || path.join(__dirname, '..', 'models', 'wan'));
const MODEL_ROOT = path.dirname(path.dirname(MODEL_DIR));
const MODEL_PATH = path.join(path.basename(path.dirname(MODEL_DIR)), path.basename(MODEL_DIR));

function request(host, path, method, headers = {}, body = null, redirects = 0) {
  return new Promise((resolve, reject) => {
    const allHeaders = { 'User-Agent': 'sd-wan-ui', ...headers };
    if (body) allHeaders['Content-Length'] = Buffer.byteLength(body);
    const target = new URL(path, 'https://' + host);
    const req = https.request({ host: target.host, path: target.pathname + target.search, method, headers: allHeaders }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume();
        const next = new URL(res.headers.location, target);
        const nextHeaders = { ...allHeaders };
        if (next.host !== target.host) delete nextHeaders.Authorization;
        return request(next.host, next.pathname + next.search, method, nextHeaders, body, redirects + 1).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.end(body);
    else req.end();
  });
}

async function hubLogin() {
  const body = JSON.stringify({ username, password });
  const res = await request('hub.docker.com', '/v2/users/login/', 'POST', {
    'Content-Type': 'application/json'
  }, body);
  if (res.status !== 200) throw new Error('hub login HTTP ' + res.status);
  const token = JSON.parse(res.body.toString()).token;
  if (!token) throw new Error('no hub token');
  return token;
}

async function createRepo() {
  const token = await hubLogin();
  const body = JSON.stringify({
    name: TARGET_NAME,
    description: 'Full portable Wan 2.1 UI with offline models and pipeline guide included.'
  });
  const res = await request('hub.docker.com', '/v2/repositories/snipkode/', 'POST', {
    Authorization: 'JWT ' + token,
    'Content-Type': 'application/json'
  }, body);
  const text = res.body.toString();
  if (res.status !== 201 && res.status !== 409 && !(res.status === 400 && text.includes('already exists'))) {
    throw new Error('create repo HTTP ' + res.status + ': ' + text.slice(0, 300));
  }
  console.log(res.status === 201 ? 'repo created' : 'repo already exists');
}

async function registryToken() {
  const scopes = [
    'repository:snipkode/sd-wan:pull',
    'repository:snipkode/sd-wan-offline:pull,push'
  ];
  const query = scopes.map((s) => 'scope=' + encodeURIComponent(s)).join('&');
  const res = await request('auth.docker.io', '/token?service=registry.docker.io&' + query, 'GET', {
    Authorization: 'Basic ' + auth
  });
  if (res.status !== 200) throw new Error('registry token HTTP ' + res.status);
  const token = JSON.parse(res.body.toString()).token;
  if (!token) throw new Error('no registry token');
  return token;
}

function reg(token, method, path, headers = {}, body = null) {
  return request('registry-1.docker.io', path, method, {
    Authorization: 'Bearer ' + token,
    ...headers
  }, body);
}

function locationPath(location) {
  const url = new URL(location, 'https://registry-1.docker.io');
  return url.pathname + url.search;
}

function hashStream(hash) {
  return new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    }
  });
}

function progressStream(label) {
  const state = { bytes: 0, next: 500 * 1024 * 1024 };
  const stream = new Transform({
    transform(chunk, encoding, callback) {
      state.bytes += chunk.length;
      if (state.bytes >= state.next) {
        console.error(label, Math.round(state.bytes / (1024 * 1024)) + ' MB');
        state.next += 500 * 1024 * 1024;
      }
      callback(null, chunk);
    }
  });
  return { stream, state };
}

function devnull() {
  return new Writable({
    write(chunk, encoding, callback) {
      callback();
    }
  });
}

function tarProcess() {
  const proc = spawn('tar', ['-cf', '-', '-C', MODEL_ROOT, MODEL_PATH], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  proc.stderr.on('data', (d) => stderr += d);
  return { proc, getStderr: () => stderr };
}

async function waitTar(proc, getStderr) {
  let code = proc.exitCode;
  if (code === null && proc.signalCode === null) [code] = await once(proc, 'close');
  if (code !== 0) throw new Error('tar exit ' + code + ': ' + getStderr().slice(0, 300));
}

async function measureLayer() {
  const rawHash = crypto.createHash('sha256');
  const gzipHash = crypto.createHash('sha256');
  const { stream: progress, state } = progressStream('scan');
  const { proc, getStderr } = tarProcess();
  await pipeline(
    proc.stdout,
    hashStream(rawHash),
    zlib.createGzip({ level: 6 }),
    hashStream(gzipHash),
    progress,
    devnull()
  );
  await waitTar(proc, getStderr);
  return {
    diffId: 'sha256:' + rawHash.digest('hex'),
    digest: 'sha256:' + gzipHash.digest('hex'),
    size: state.bytes
  };
}

async function uploadBuffer(token, digest, buffer) {
  const start = await reg(token, 'POST', '/v2/' + TARGET_REPO + '/blobs/uploads/', {});
  if (start.status !== 202) throw new Error('blob start HTTP ' + start.status);
  const uploadPath = locationPath(start.headers.location);
  const patched = await reg(token, 'PATCH', uploadPath, {
    'Content-Type': 'application/octet-stream'
  }, buffer);
  if (patched.status !== 201 && patched.status !== 202) {
    throw new Error('blob patch HTTP ' + patched.status);
  }
  const finalUrl = new URL(patched.headers.location, 'https://registry-1.docker.io');
  finalUrl.searchParams.set('digest', digest);
  const finalized = await reg(token, 'PUT', finalUrl.pathname + finalUrl.search, {
    'Content-Length': '0'
  });
  if (finalized.status !== 201) throw new Error('blob finish HTTP ' + finalized.status);
}

async function hasBlob(token, digest) {
  const res = await reg(token, 'HEAD', '/v2/' + TARGET_REPO + '/blobs/' + digest, {});
  return res.status === 200;
}

async function mountOrUploadBlob(token, digest, fromRepo) {
  const mountPath = '/v2/' + TARGET_REPO + '/blobs/uploads/?mount=' + encodeURIComponent(digest) + '&from=' + encodeURIComponent(fromRepo);
  const mounted = await reg(token, 'POST', mountPath, {});
  if (mounted.status === 201) return 'mounted';
  if (mounted.status !== 202) throw new Error('blob mount HTTP ' + mounted.status);
  const source = await reg(token, 'GET', '/v2/' + SOURCE_REPO + '/blobs/' + digest, {});
  if (source.status !== 200) throw new Error('source blob HTTP ' + source.status);
  await uploadBuffer(token, digest, source.body);
  return 'uploaded';
}

function streamingPatch(token, uploadPath, expectedSize) {
  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/octet-stream',
    'Content-Length': expectedSize,
    'User-Agent': 'sd-wan-ui'
  };
  const req = https.request({
    host: 'registry-1.docker.io',
    path: uploadPath,
    method: 'PATCH',
    headers
  });
  return { req, done: new Promise((resolve, reject) => {
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
  }) };
}

async function uploadLayer(token, measured) {
  if (await hasBlob(token, measured.digest)) {
    console.log('layer already exists');
    return {
      layer: { digest: measured.digest, size: measured.size, diffId: measured.diffId },
      token
    };
  }
  const start = await reg(token, 'POST', '/v2/' + TARGET_REPO + '/blobs/uploads/', {});
  if (start.status !== 202) throw new Error('layer start HTTP ' + start.status);
  const uploadPath = locationPath(start.headers.location);
  const { req, done } = streamingPatch(token, uploadPath, measured.size);
  const rawHash = crypto.createHash('sha256');
  const gzipHash = crypto.createHash('sha256');
  const { stream: progress, state } = progressStream('upload');
  const { proc, getStderr } = tarProcess();
  await pipeline(
    proc.stdout,
    hashStream(rawHash),
    zlib.createGzip({ level: 6 }),
    hashStream(gzipHash),
    progress,
    req
  );
  await waitTar(proc, getStderr);
  const patched = await done;
  if (patched.status !== 201 && patched.status !== 202) {
    throw new Error('layer patch HTTP ' + patched.status + ': ' + patched.body.toString().slice(0, 300));
  }
  const diffId = 'sha256:' + rawHash.digest('hex');
  const digest = 'sha256:' + gzipHash.digest('hex');
  if (diffId !== measured.diffId || digest !== measured.digest || state.bytes !== measured.size) {
    throw new Error('layer digest mismatch');
  }
  const finalUrl = new URL(patched.headers.location, 'https://registry-1.docker.io');
  finalUrl.searchParams.set('digest', digest);
  const freshToken = await registryToken();
  const finalized = await reg(freshToken, 'PUT', finalUrl.pathname + finalUrl.search, {
    'Content-Length': '0'
  });
  if (finalized.status !== 201) throw new Error('layer finish HTTP ' + finalized.status);
  console.log('layer uploaded', Math.round(state.bytes / (1024 * 1024)) + ' MB');
  return {
    layer: { digest, size: state.bytes, diffId },
    token: freshToken
  };
}

async function getManifest(token) {
  const accept = 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json';
  const res = await reg(token, 'GET', '/v2/' + SOURCE_REPO + '/manifests/' + TAG, { Accept: accept });
  if (res.status !== 200) throw new Error('manifest HTTP ' + res.status);
  let manifest = JSON.parse(res.body.toString());
  const mediaType = res.headers['content-type']?.split(';')[0] || manifest.mediaType;
  if (manifest.manifests) {
    const target = manifest.manifests.find((m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64');
    if (!target) throw new Error('no amd64 manifest');
    const selected = await reg(token, 'GET', '/v2/' + SOURCE_REPO + '/manifests/' + target.digest, { Accept: accept });
    if (selected.status !== 200) throw new Error('selected manifest HTTP ' + selected.status);
    manifest = JSON.parse(selected.body.toString());
    return { manifest, mediaType: selected.headers['content-type']?.split(';')[0] || manifest.mediaType };
  }
  return { manifest, mediaType };
}

(async () => {
  await createRepo();
  let token = await registryToken();
  const { manifest, mediaType } = await getManifest(token);
  const configRes = await reg(token, 'GET', '/v2/' + SOURCE_REPO + '/blobs/' + manifest.config.digest);
  if (configRes.status !== 200) throw new Error('config HTTP ' + configRes.status);
  const baseConfig = JSON.parse(configRes.body.toString());

  console.log('measuring model layer', MODEL_DIR);
  const measured = await measureLayer();
  console.log('model layer', Math.round(measured.size / (1024 * 1024)) + ' MB compressed');

  token = await registryToken();
  for (const layer of manifest.layers) {
    console.log('mounting base layer', await mountOrUploadBlob(token, layer.digest, SOURCE_REPO));
  }

  token = await registryToken();
  const uploaded = await uploadLayer(token, measured);
  const layer = uploaded.layer;
  token = uploaded.token;
  const created = new Date().toISOString();
  baseConfig.created = created;
  baseConfig.rootfs = baseConfig.rootfs || { type: 'layers', diff_ids: [] };
  baseConfig.rootfs.diff_ids.push(layer.diffId);
  baseConfig.history = baseConfig.history || [];
  baseConfig.history.push({ created, created_by: 'add offline wan models' });

  const configBuffer = Buffer.from(JSON.stringify(baseConfig));
  const configDigest = 'sha256:' + crypto.createHash('sha256').update(configBuffer).digest('hex');
  console.log('uploading config');
  token = await registryToken();
  await uploadBuffer(token, configDigest, configBuffer);

  const newManifest = {
    schemaVersion: 2,
    mediaType,
    config: {
      ...manifest.config,
      digest: configDigest,
      size: configBuffer.length
    },
    layers: [
      ...manifest.layers,
      {
        mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
        digest: layer.digest,
        size: layer.size
      }
    ]
  };

  token = await registryToken();
  const pushed = await reg(token, 'PUT', '/v2/' + TARGET_REPO + '/manifests/' + TAG, {
    'Content-Type': mediaType
  }, Buffer.from(JSON.stringify(newManifest)));
  if (pushed.status !== 201 && pushed.status !== 202) {
    throw new Error('manifest push HTTP ' + pushed.status + ': ' + pushed.body.toString().slice(0, 300));
  }
  console.log('pushed', TARGET_REPO + ':' + TAG, pushed.headers['docker-content-digest'] || '');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

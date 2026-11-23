const $ = (id) => document.getElementById(id);
const conn = $('conn');
const log = $('log');
const gallery = $('gallery');
const empty = $('empty');
const jobStatus = $('jobStatus');
const jobMeta = $('jobMeta');
const eta = $('eta');
const genBtn = $('genBtn');
const stopBtn = $('stopBtn');
const barFill = $('barFill');
const fileCount = $('fileCount');
const clock = $('clock');
const presetDuration = $('presetDuration');
const presetQuality = $('presetQuality');
const presetHint = $('presetHint');
const presetSizeSelect = $('presetSizeSelect');
const presetWidth = $('presetWidth');
const presetHeight = $('presetHeight');
const customSize = $('customSize');
const orientLandscape = $('orientLandscape');
const orientPortrait = $('orientPortrait');
const presetRow = $('presetRow');
const presetPanel = $('presetPanel');
const manualPanel = $('manualPanel');
const configPreset = $('configPreset');
const configManual = $('configManual');
const configGroup = $('configGroup');
const promptGroup = $('promptGroup');
const outfitPanel = $('outfitPanel');
const modeImage = $('modeImage');
const modeVideo = $('modeVideo');
const modeOutfit = $('modeOutfit');
const pagination = $('pagination');
const prevPage = $('prevPage');
const nextPage = $('nextPage');
const pageInfo = $('pageInfo');
const lightbox = $('lightbox');
const lightboxMedia = $('lightboxMedia');
const lightboxCaption = $('lightboxCaption');
const lightboxDetails = $('lightboxDetails');
const lightboxClose = $('lightboxClose');
const lightboxPrev = $('lightboxPrev');
const lightboxNext = $('lightboxNext');
const zoomControls = $('zoomControls');
const zoomIn = $('zoomIn');
const zoomOut = $('zoomOut');
const zoomLevel = $('zoomLevel');
const guideModal = $('guideModal');
const guideBtn = $('guideBtn');
const guideClose = $('guideClose');
const pipelineSteps = $('pipelineSteps');
const pipelineStage = $('pipelineStage');
const menuBtn = $('menuBtn');
const sidebar = $('sidebar');
const sidebarOverlay = $('sidebarOverlay');
const sidebarClose = $('sidebarClose');
const sidebarStatus = $('sidebarStatus');
const pageGenerate = $('pageGenerate');
const pageResults = $('pageResults');
const sideResultCount = $('sideResultCount');
const sideLinks = Array.from(document.querySelectorAll('.side-link[data-page]'));

let generateMode = 'image';
let configMode = 'preset';
let orientation = 'landscape';
let presetData = null;
let galleryFiles = [];
let activeFilter = 'all';
let currentPage = 1;
let galleryLoading = false;
let galleryPending = false;
let lightboxIndex = -1;
let lightboxZoomIndex = 0;
let lightboxPan = { x: 0, y: 0 };
let lightboxDrag = null;
let currentJob = null;
let logReady = false;
let pipelineDetail = '';
const PAGE_SIZE = 12;
const ACTIVE_STATUSES = ['starting', 'running', 'decoding', 'encoding', 'stopping'];
const SIZE_OPTIONS = [
  { key: 'small', label: 'Kecil', width: 320, height: 256 },
  { key: 'medium', label: 'Sedang', width: 512, height: 320 },
  { key: 'high', label: 'Besar', width: 640, height: 400 },
  { key: 'large', label: 'Lebih besar', width: 768, height: 512 }
];
const ZOOM_STEPS = [1, 1.25, 1.5, 2, 3, 4];
const PIPELINE = [
  { id: 'input', title: 'Input & config', model: 'form → server', short: 'Prompt, steps, dan ukuran.', detail: 'Prompt, negative prompt, jumlah frame, steps, CFG, dan resolusi dikirim dari browser ke server.' },
  { id: 'text', title: 'Text encoder', model: 'umt5-xxl-encoder-Q3_K_S.gguf', short: 'Teks jadi conditioning.', detail: 'Prompt diubah model UMT5-XXL menjadi vektor kondisi supaya model gambar paham permintaan user.' },
  { id: 'sampling', title: 'Diffusion sampling', model: 'wan2.1_t2v_1.3b-q4_k_m.gguf', short: 'Koreksi latent 4/10/20×.', detail: 'Model Wan mengulang denoising sebanyak nilai steps. Makin tinggi steps biasanya makin detail, tapi makin lama.' },
  { id: 'vae', title: 'VAE decode', model: 'taew2_1.safetensors', short: 'Latent jadi piksel/frame.', detail: 'Tiny VAE menerjemahkan hasil latent diffusion menjadi frame gambar yang bisa dilihat.' },
  { id: 'video', title: 'Video encode', model: 'ffmpeg', short: 'AVI → MP4 H.264.', detail: 'Hanya dipakai untuk frames lebih dari 1. AVI hasil sd-cli dikonversi ke MP4 H.264 yuv420p agar mudah diputar.' },
  { id: 'output', title: 'Output & meta', model: '/root/out · .json', short: 'Simpan file + detail.', detail: 'File akhir dan sidecar JSON berisi prompt, ukuran, steps, dan durasi proses disimpan lalu masuk galeri.' }
];

const PIPELINE_OUTFIT = [
  { id: 'input', title: 'Foto & mask', model: 'ffmpeg', short: 'Foto + area baju jadi PNG.', detail: 'Foto karakter di-resize ke ukuran target, lalu area baju dari slider diubah jadi mask putih; bagian lain hitam dan akan dipertahankan.' },
  { id: 'text', title: 'Prompt outfit', model: 'CLIP / SD1.5', short: 'Prompt jadi conditioning.', detail: 'Prompt outfit diproses model teks SD1.5 untuk memberi arah karakter pakaian baru.' },
  { id: 'sampling', title: 'Inpainting', model: 'sd-v1-5-inpainting Q4_0', short: 'Isi ulang area mask.', detail: 'Model inpainting mengganti hanya area putih pada mask sambil menjaga wajah, tangan, dan bentuk tubuh di area hitam.' },
  { id: 'vae', title: 'VAE decode', model: 'SD VAE', short: 'Latent jadi piksel.', detail: 'Hasil latent diffusion diterjemahkan menjadi gambar PNG akhir.' },
  { id: 'output', title: 'Output & meta', model: '/root/out · .json', short: 'Simpan file + detail.', detail: 'Gambar akhir dan sidecar JSON berisi prompt, ukuran, strength, mask, dan durasi proses disimpan lalu masuk galeri.' }
];

function activePipeline() {
  const busy = currentJob && ACTIVE_STATUSES.includes(currentJob.status);
  if (busy && currentJob.kind) return currentJob.kind === 'outfit' ? PIPELINE_OUTFIT : PIPELINE;
  return generateMode === 'outfit' ? PIPELINE_OUTFIT : PIPELINE;
}

function generatorLabel() {
  if (generateMode === 'outfit') return 'Ganti Outfit';
  return generateMode === 'image' ? 'Generate Gambar' : 'Generate Video';
}

function setConfigMode(mode) {
  configMode = mode === 'manual' ? 'manual' : 'preset';
  const isPreset = configMode === 'preset';
  configPreset.classList.toggle('active', isPreset);
  configManual.classList.toggle('active', !isPreset);
  configPreset.setAttribute('aria-pressed', String(isPreset));
  configManual.setAttribute('aria-pressed', String(!isPreset));
  presetPanel.hidden = !isPreset;
  manualPanel.hidden = isPreset;
  if (isPreset) applyPreset();
  else $('advanced').open = true;
}

function fmtEta(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '<1 detik';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes} menit ${restSeconds} detik` : `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} jam ${restMinutes} menit` : `${hours} jam`;
}

function updateEta() {
  if (!currentJob || !ACTIVE_STATUSES.includes(currentJob.status) || currentJob.status === 'stopping') {
    eta.hidden = true;
    return;
  }
  eta.hidden = false;
  const started = Date.parse(currentJob.startedAt);
  const elapsed = Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0;
  const progress = currentJob.progress || {};
  const total = Number(progress.total) || 0;
  const current = Number(progress.current) || 0;
  const percent = Number(progress.percent) || 0;
  const ratio = percent > 0 ? percent / 100 : total > 0 ? current / total : 0;
  if (!ratio || elapsed < 3000) {
    eta.textContent = `ETA menghitung… · berjalan ${fmtEta(elapsed)}`;
    return;
  }
  const remaining = Math.max(0, elapsed / Math.min(1, ratio) - elapsed);
  const finish = new Date(Date.now() + remaining).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  eta.textContent = `ETA ~${fmtEta(remaining)} · selesai ~${finish}`;
}

function renderPipelineShell() {
  const steps = activePipeline();
  pipelineSteps.innerHTML = steps.map((step, i) => `<li class="pipeline-step" data-stage="${step.id}" data-index="${i + 1}" title="${step.detail}"><strong>${step.title}</strong><code>${step.model}</code><small>${step.short}</small></li>`).join('');
  updatePipeline(currentJob);
}

function notePipeline(stage, line) {
  if (!stage) return;
  pipelineDetail = String(line || '').slice(0, 120);
  if (currentJob) {
    currentJob.stage = stage;
    updatePipeline(currentJob);
    return;
  }
  const step = activePipeline().find((item) => item.id === stage);
  pipelineStage.textContent = step ? step.title : stage;
  pipelineStage.title = pipelineDetail;
}

function updatePipeline(job) {
  const steps = activePipeline();
  const frames = Number(job && job.frames) || Number($('frames').value) || 1;
  const isVideo = frames > 1 && !(job && job.kind === 'outfit');
  const current = job && job.stage ? steps.findIndex((item) => item.id === job.stage) : -1;
  const finished = Boolean(job && job.status === 'done');
  const failed = Boolean(job && ['error', 'stopped', 'stopping'].includes(job.status));
  const activeIndex = Math.max(0, current);
  if (!job) {
    pipelineStage.textContent = 'menunggu job';
    pipelineStage.removeAttribute('title');
  } else if (finished) {
    pipelineStage.textContent = 'selesai · output tersimpan';
    pipelineStage.removeAttribute('title');
  } else {
    const step = steps[activeIndex] || steps[0];
    const pct = job.status === 'running' && job.progress && job.progress.percent ? ` · ${job.progress.percent}%` : '';
    pipelineStage.textContent = `${step.title}${pct}${failed ? ` · ${job.status}` : ''}`;
    if (pipelineDetail) pipelineStage.title = pipelineDetail;
    else pipelineStage.removeAttribute('title');
  }
  Array.from(pipelineSteps.children).forEach((el, i) => {
    const skipped = steps[i].id === 'video' && !isVideo;
    const done = !skipped && (finished || (current >= 0 && i < current));
    const active = !skipped && !finished && !failed && Boolean(job) && i === activeIndex;
    const bad = !skipped && failed && Boolean(job) && i === activeIndex;
    el.classList.toggle('skipped', skipped);
    el.classList.toggle('done', done);
    el.classList.toggle('active', active);
    el.classList.toggle('failed', bad);
    if (active || bad) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
  });
}

if (window.innerWidth < 700) $('advanced').open = false;

function setConn(text, ok) {
  conn.textContent = text;
  conn.className = `pill ${ok ? 'ok' : 'bad'}`;
  if (sidebarStatus) {
    sidebarStatus.className = `sidebar-status ${ok ? 'ok' : 'bad'}`;
    sidebarStatus.lastElementChild.textContent = text;
  }
}

function pushLog(line) {
  if (!logReady) {
    log.textContent = '';
    logReady = true;
  }
  log.textContent += `${log.textContent ? '\n' : ''}${line}`;
  const lines = log.textContent.split('\n');
  if (lines.length > 140) log.textContent = lines.slice(-140).join('\n');
  log.scrollTop = log.scrollHeight;
}

function fmt(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function orientedSize(width, height) {
  return orientation === 'portrait' ? { width: height, height: width } : { width, height };
}

function sizeLabel(width, height) {
  return `${width}×${height} px`;
}

function currentPresetSize() {
  const quality = presetData && presetData.qualities[presetQuality.value];
  const mode = presetSizeSelect.value || 'auto';
  customSize.hidden = mode !== 'manual';
  if (mode === 'manual') {
    return { width: Number.parseInt(presetWidth.value, 10), height: Number.parseInt(presetHeight.value, 10), source: 'manual' };
  }
  if (mode === 'auto') {
    if (!quality) return null;
    return { ...orientedSize(quality.width, quality.height), source: 'kualitas' };
  }
  const option = SIZE_OPTIONS.find((item) => item.key === mode);
  if (!option) return null;
  return { ...orientedSize(option.width, option.height), source: option.label };
}

function refreshSizeOptions() {
  const previous = presetSizeSelect.value || 'auto';
  presetSizeSelect.innerHTML = '<option value="auto">Ikut kualitas</option>';
  for (const option of SIZE_OPTIONS) {
    const size = orientedSize(option.width, option.height);
    const el = document.createElement('option');
    el.value = option.key;
    el.textContent = `${option.label} · ${sizeLabel(size.width, size.height)}`;
    presetSizeSelect.appendChild(el);
  }
  const manual = document.createElement('option');
  manual.value = 'manual';
  manual.textContent = 'Manual…';
  presetSizeSelect.appendChild(manual);
  presetSizeSelect.value = previous;
  customSize.hidden = previous !== 'manual';
}

function setOrientation(value) {
  orientation = value === 'portrait' ? 'portrait' : 'landscape';
  orientLandscape.classList.toggle('active', orientation === 'landscape');
  orientPortrait.classList.toggle('active', orientation === 'portrait');
  orientLandscape.setAttribute('aria-pressed', String(orientation === 'landscape'));
  orientPortrait.setAttribute('aria-pressed', String(orientation === 'portrait'));
  if (presetSizeSelect.value === 'manual') {
    const width = Number.parseInt(presetWidth.value, 10);
    const height = Number.parseInt(presetHeight.value, 10);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      presetWidth.value = String(height);
      presetHeight.value = String(width);
    }
  }
  refreshSizeOptions();
  applyPreset();
}

function applyPreset() {
  presetHint.className = '';
  const size = currentPresetSize();
  const usable = size && Number.isFinite(size.width) && Number.isFinite(size.height);
  if (usable) {
    $('width').value = String(size.width);
    $('height').value = String(size.height);
  }
  if (!presetData) return;
  const quality = presetData.qualities[presetQuality.value];
  if (quality) {
    $('steps').value = String(quality.steps);
    $('cfg').value = String(quality.cfg);
  }
  const text = usable ? sizeLabel(size.width, size.height) : '—';
  const source = usable ? size.source : '';
  if (generateMode === 'image') {
    $('frames').value = '1';
    presetHint.textContent = quality
      ? `Mode gambar · ${quality.label} · ${text} (${source}) · ${quality.steps} step`
      : `Mode gambar · ${text}. Pilih kualitas untuk steps/CFG.`;
    return;
  }
  const duration = presetData.durations.find((d) => String(d.seconds) === presetDuration.value);
  if (!duration || !quality) {
    presetHint.textContent = `Ukuran ${text}. Pilih durasi + kualitas untuk mengisi config otomatis.`;
    return;
  }
  $('frames').value = String(duration.frames);
  const warning = duration.frames >= 401 ? ' · berat, bisa sangat lama di CPU' : '';
  presetHint.textContent = `${duration.frames} frame ≈ ${duration.actualSeconds}s · ${quality.label} · ${text} (${source}) · ${quality.steps} step${warning}`;
  if (duration.frames >= 401) presetHint.className = 'warn';
}

async function loadPresets() {
  try {
    const response = await fetch('/api/presets');
    if (!response.ok) throw new Error('gagal memuat preset');
    presetData = await response.json();
    presetDuration.innerHTML = '<option value="">Pilih durasi</option>';
    presetQuality.innerHTML = '<option value="">Pilih kualitas</option>';
    for (const d of presetData.durations) {
      const option = document.createElement('option');
      option.value = String(d.seconds);
      option.textContent = `${d.seconds} detik (${d.frames} frame)`;
      presetDuration.appendChild(option);
    }
    for (const [key, q] of Object.entries(presetData.qualities)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = `${q.label} · ${q.steps} step`;
      presetQuality.appendChild(option);
    }
    $('frames').max = String(presetData.maxFrames);
    applyPreset();
  } catch (err) {
    presetHint.textContent = `Preset tidak tersedia: ${err.message}`;
    presetHint.className = 'warn';
  }
}

function setMode(mode) {
  generateMode = mode === 'video' ? 'video' : mode === 'outfit' ? 'outfit' : 'image';
  const isImage = generateMode === 'image';
  const isVideo = generateMode === 'video';
  const isOutfit = generateMode === 'outfit';
  modeImage.classList.toggle('active', isImage);
  modeVideo.classList.toggle('active', isVideo);
  modeOutfit.classList.toggle('active', isOutfit);
  modeImage.setAttribute('aria-pressed', String(isImage));
  modeVideo.setAttribute('aria-pressed', String(isVideo));
  modeOutfit.setAttribute('aria-pressed', String(isOutfit));
  const busy = currentJob && ACTIVE_STATUSES.includes(currentJob.status);
  genBtn.textContent = busy ? 'Generating…' : generatorLabel();
  configGroup.hidden = isOutfit;
  promptGroup.hidden = isOutfit;
  outfitPanel.hidden = !isOutfit;
  presetPanel.hidden = isOutfit || configMode !== 'preset';
  manualPanel.hidden = isOutfit || configMode !== 'manual';
  presetDuration.parentElement.hidden = !isVideo;
  presetRow.classList.toggle('single', !isVideo);
  presetDuration.disabled = !isVideo;
  $('frames').disabled = !isVideo;
  $('frames').min = isVideo ? '2' : '1';
  if (!isVideo) $('frames').value = '1';
  else if (Number($('frames').value) < 2) $('frames').value = '9';
  if (!isOutfit) setConfigMode(configMode);
  if (isOutfit) presetHint.textContent = 'Mode outfit: unggah foto, atur area baju, lalu isi prompt outfit.';
  else if (!presetData) presetHint.textContent = isImage
    ? 'Mode gambar: frames dikunci ke 1.'
    : 'Mode video: pilih durasi + kualitas atau atur frames manual.';
  renderPipelineShell();
}

function renderProgress(progress) {
  const pct = Math.max(0, Math.min(100, Number(progress && progress.percent) || 0));
  barFill.style.width = `${pct}%`;
  if (currentJob && ACTIVE_STATUSES.includes(currentJob.status) && currentJob.status !== 'stopping') {
    jobMeta.textContent = `${currentJob.frames} frame · ${pct}% · ${progress.current || 0}/${progress.total || currentJob.progress.total || 0}`;
  }
  updateEta();
  updatePipeline(currentJob);
}

function renderJob(job) {
  currentJob = job;
  updatePipeline(job);
  const genLabel = generatorLabel();
  if (!job) {
    jobStatus.textContent = 'idle';
    jobStatus.className = 'badge';
    jobMeta.textContent = 'siap';
    renderProgress({ percent: 0 });
    eta.hidden = true;
    genBtn.disabled = false;
    genBtn.textContent = genLabel;
    stopBtn.hidden = true;
    return;
  }
  const busy = ACTIVE_STATUSES.includes(job.status);
  const tone = job.status === 'done' ? 'ok' : job.status === 'error' ? 'bad' : job.status === 'stopped' ? 'stopped' : 'busy';
  jobStatus.textContent = job.status;
  jobStatus.className = `badge ${tone}`;
  if (job.error) jobMeta.textContent = job.error.slice(0, 110);
  else if (job.warning) jobMeta.textContent = job.warning.slice(0, 110);
  else if (job.status === 'done') {
    const spent = Number.isFinite(job.durationMs) ? ` · ${fmtDuration(job.durationMs)}` : '';
    jobMeta.textContent = job.output ? `selesai · ${job.output}${spent}` : `selesai${spent}`;
  }
  else if (job.status === 'stopped') jobMeta.textContent = 'dihentikan · tanpa output akhir';
  else jobMeta.textContent = `${job.frames} frame · ${job.progress.percent || 0}%`;
  renderProgress(job.progress || { percent: 0 });
  genBtn.disabled = busy;
  genBtn.textContent = busy ? 'Generating…' : genLabel;
  stopBtn.hidden = !busy;
  stopBtn.disabled = job.status === 'stopping';
  stopBtn.textContent = job.status === 'stopping' ? 'Stopping…' : 'Stop';
}

function renderCounts(counts) {
  if (!counts) return;
  fileCount.textContent = `${counts.all} file · ${counts.video} video`;
  if (sideResultCount) sideResultCount.textContent = `${counts.all} file`;
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} detik`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes} menit ${rest} detik` : `${minutes} menit`;
}

function renderDetails(meta) {
  lightboxDetails.textContent = '';
  if (!meta || typeof meta !== 'object') {
    const empty = document.createElement('p');
    empty.className = 'lightbox-details-empty';
    empty.textContent = 'Detail prompt untuk file lama tidak tersedia. Detail tersedia untuk hasil baru.';
    lightboxDetails.appendChild(empty);
    return;
  }
  const dl = document.createElement('dl');
  const finished = meta.finishedAt && Number.isFinite(Date.parse(meta.finishedAt))
    ? new Date(meta.finishedAt).toLocaleString()
    : '—';
  const frameText = meta.frames
    ? `${meta.frames}${Number.isFinite(meta.videoSeconds) ? ` · ≈${meta.videoSeconds}s video` : ''}`
    : '—';
  const rows = [
    ['Prompt', meta.prompt || '—'],
    ['Negative', meta.negative || '—'],
    ['Durasi proses', fmtDuration(meta.durationMs)],
    ['Selesai', finished],
    ['Frame', frameText],
    ['Pengaturan', `${meta.width || '—'}x${meta.height || '—'} · ${meta.steps || '—'} step · CFG ${meta.cfg ?? '—'}`]
  ];
  if (meta.warning) rows.push(['Catatan', meta.warning]);
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    dl.append(dt, dd);
  }
  lightboxDetails.appendChild(dl);
}

function lightboxImage() {
  return lightboxMedia.querySelector('img');
}

function clampLightboxPan(img) {
  const zoom = ZOOM_STEPS[lightboxZoomIndex];
  if (zoom <= 1) {
    lightboxPan = { x: 0, y: 0 };
    return;
  }
  const box = lightboxMedia.getBoundingClientRect();
  const naturalWidth = img.naturalWidth || box.width;
  const naturalHeight = img.naturalHeight || box.height;
  if (!naturalWidth || !naturalHeight) return;
  const fit = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const maxX = Math.max(0, (naturalWidth * fit * zoom - box.width) / 2);
  const maxY = Math.max(0, (naturalHeight * fit * zoom - box.height) / 2);
  lightboxPan.x = Math.max(-maxX, Math.min(maxX, lightboxPan.x));
  lightboxPan.y = Math.max(-maxY, Math.min(maxY, lightboxPan.y));
}

function applyLightboxZoom() {
  const img = lightboxImage();
  const zoom = ZOOM_STEPS[lightboxZoomIndex];
  zoomControls.hidden = !img;
  zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
  zoomOut.disabled = lightboxZoomIndex === 0;
  zoomIn.disabled = lightboxZoomIndex === ZOOM_STEPS.length - 1;
  if (!img) return;
  clampLightboxPan(img);
  img.style.transform = `translate(${lightboxPan.x}px, ${lightboxPan.y}px) scale(${zoom})`;
  img.classList.toggle('zoomed', zoom > 1);
}

function setLightboxZoom(index) {
  const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index));
  if (next === lightboxZoomIndex) return;
  lightboxZoomIndex = next;
  if (lightboxZoomIndex === 0) lightboxPan = { x: 0, y: 0 };
  applyLightboxZoom();
}

function resetLightboxZoom() {
  lightboxZoomIndex = 0;
  lightboxPan = { x: 0, y: 0 };
  lightboxDrag = null;
  applyLightboxZoom();
}

function bindLightboxDrag(img) {
  img.addEventListener('pointerdown', (event) => {
    if (ZOOM_STEPS[lightboxZoomIndex] <= 1) return;
    lightboxDrag = { id: event.pointerId, x: event.clientX - lightboxPan.x, y: event.clientY - lightboxPan.y };
    img.setPointerCapture(event.pointerId);
    img.classList.add('dragging');
  });
  img.addEventListener('pointermove', (event) => {
    if (!lightboxDrag || lightboxDrag.id !== event.pointerId) return;
    lightboxPan.x = event.clientX - lightboxDrag.x;
    lightboxPan.y = event.clientY - lightboxDrag.y;
    applyLightboxZoom();
  });
  const stop = (event) => {
    if (!lightboxDrag || lightboxDrag.id !== event.pointerId) return;
    lightboxDrag = null;
    img.classList.remove('dragging');
  };
  img.addEventListener('pointerup', stop);
  img.addEventListener('pointercancel', stop);
}

function renderLightbox() {
  const f = galleryFiles[lightboxIndex];
  resetLightboxZoom();
  lightboxMedia.textContent = '';
  lightboxPrev.disabled = lightboxIndex <= 0;
  lightboxNext.disabled = lightboxIndex >= galleryFiles.length - 1;
  if (!f) {
    lightboxCaption.textContent = '';
    lightboxDetails.textContent = '';
    return;
  }
  const src = `/out/${encodeURIComponent(f.name)}`;
  if (f.type === 'video') {
    const video = document.createElement('video');
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    lightboxMedia.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.alt = f.name;
    img.addEventListener('load', applyLightboxZoom);
    bindLightboxDrag(img);
    img.src = src;
    lightboxMedia.appendChild(img);
  }
  applyLightboxZoom();
  lightboxCaption.textContent = `${f.name} · ${fmt(f.size)}`;
  renderDetails(f.meta);
}

function showLightbox(index) {
  if (index < 0 || index >= galleryFiles.length) return;
  lightboxIndex = index;
  renderLightbox();
  if (!lightbox.open) lightbox.showModal();
}

function renderGallery(files) {
  galleryFiles = files;
  gallery.textContent = '';
  empty.hidden = files.length > 0;
  empty.textContent = activeFilter === 'video'
    ? 'Belum ada video. Set Frames > 1 saat generate.'
    : 'Belum ada hasil.';
  files.forEach((f, index) => {
    const card = document.createElement('div');
    card.className = 'card';
    const media = document.createElement('div');
    media.className = 'media';
    const src = `/out/${encodeURIComponent(f.name)}`;
    if (f.type === 'video') {
      const video = document.createElement('video');
      video.src = src;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      media.appendChild(video);
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'VIDEO';
      media.appendChild(tag);
    } else {
      const img = document.createElement('img');
      img.src = src;
      img.alt = f.name;
      img.loading = 'lazy';
      media.appendChild(img);
    }
    media.addEventListener('click', () => showLightbox(index));

    const meta = document.createElement('div');
    meta.className = 'meta';
    const link = document.createElement('a');
    link.href = src;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = f.name;
    link.title = f.name;
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = fmt(f.size);
    const download = document.createElement('a');
    download.className = 'download';
    download.href = `${src}?download=1`;
    download.download = f.name;
    download.title = 'Download';
    download.textContent = '↓';
    download.setAttribute('aria-label', `Download ${f.name}`);
    const remove = document.createElement('button');
    remove.className = 'delete';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Hapus';
    remove.setAttribute('aria-label', `Hapus ${f.name}`);
    remove.addEventListener('click', () => deleteAssetFile(f.name));
    meta.append(link, size, download, remove);
    card.append(media, meta);
    gallery.appendChild(card);
  });
}

async function deleteAssetFile(name) {
  if (!confirm(`Hapus ${name}?`)) return;
  try {
    const response = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'gagal menghapus file');
    if (lightbox.open && galleryFiles[lightboxIndex] && galleryFiles[lightboxIndex].name === name) lightbox.close();
    pushLog(`hapus: ${name}`);
    await loadFiles(currentPage);
  } catch (err) {
    pushLog(`ERROR: ${err.message}`);
    alert(err.message);
  }
}

async function loadFiles(targetPage = currentPage) {
  if (galleryLoading) {
    galleryPending = true;
    return;
  }
  galleryLoading = true;
  prevPage.disabled = true;
  nextPage.disabled = true;
  try {
    const params = new URLSearchParams({ page: String(targetPage), limit: String(PAGE_SIZE), type: activeFilter });
    const response = await fetch(`/api/files?${params}`);
    if (!response.ok) throw new Error('gagal memuat hasil');
    const data = await response.json();
    currentPage = data.page;
    renderCounts(data.counts);
    renderGallery(data.files);
    pageInfo.textContent = `${data.page} / ${data.pages}`;
    pagination.hidden = data.pages <= 1;
    prevPage.disabled = !data.hasPrev;
    nextPage.disabled = !data.hasNext;
  } catch (err) {
    empty.hidden = false;
    empty.textContent = `Gagal memuat hasil: ${err.message}`;
  } finally {
    galleryLoading = false;
    if (galleryPending) {
      galleryPending = false;
      loadFiles(currentPage);
    }
  }
}

renderPipelineShell();
const es = new EventSource('/api/stream');
es.addEventListener('open', () => setConn('live', true));
es.addEventListener('error', () => setConn('reconnect', false));
es.addEventListener('hello', (event) => {
  const data = JSON.parse(event.data);
  renderJob(data.job);
  renderCounts(data.counts);
});
es.addEventListener('status', (event) => renderJob(JSON.parse(event.data).job));
es.addEventListener('progress', (event) => renderProgress(JSON.parse(event.data).progress));
es.addEventListener('log', (event) => {
  const data = JSON.parse(event.data);
  pushLog(data.line);
  notePipeline(data.stage, data.line);
});
es.addEventListener('files', (event) => {
  renderCounts(JSON.parse(event.data).counts);
  loadFiles(currentPage);
});
es.addEventListener('file', (event) => pushLog(`file baru: ${event.data ? JSON.parse(event.data).file.name : ''}`));

modeImage.addEventListener('click', () => setMode('image'));
modeVideo.addEventListener('click', () => setMode('video'));
modeOutfit.addEventListener('click', () => setMode('outfit'));
configPreset.addEventListener('click', () => setConfigMode('preset'));
configManual.addEventListener('click', () => setConfigMode('manual'));
presetDuration.addEventListener('change', applyPreset);
presetQuality.addEventListener('change', applyPreset);
presetSizeSelect.addEventListener('change', applyPreset);
presetWidth.addEventListener('input', applyPreset);
presetHeight.addEventListener('input', applyPreset);
orientLandscape.addEventListener('click', () => setOrientation('landscape'));
orientPortrait.addEventListener('click', () => setOrientation('portrait'));
$('frames').addEventListener('input', () => updatePipeline(currentJob));
refreshSizeOptions();
setConfigMode('preset');
setMode('image');
loadPresets();
loadFiles(1);
setInterval(updateEta, 1000);

async function applyStartResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'gagal memulai inference');
  logReady = false;
  pushLog(`job ${data.job.id} dimulai · ${data.job.output}`);
  renderJob(data.job);
}

async function submitOutfit() {
  const file = $('outfitImage').files[0];
  if (!file) {
    alert('Foto karakter wajib diunggah.');
    return;
  }
  const width = Number($('outfitWidth').value);
  const height = Number($('outfitHeight').value);
  const validSize = Number.isInteger(width) && Number.isInteger(height)
    && width >= 256 && width <= 1024 && height >= 256 && height <= 1024
    && width % 16 === 0 && height % 16 === 0;
  if (!validSize) {
    alert('Ukuran harus antara 256–1024 px dan kelipatan 16.');
    return;
  }
  const form = new FormData();
  form.append('image', file);
  form.append('prompt', $('outfitPrompt').value.trim());
  form.append('negative', $('outfitNegative').value.trim());
  form.append('steps', $('outfitSteps').value);
  form.append('width', String(width));
  form.append('height', String(height));
  form.append('cfg', $('outfitCfg').value);
  form.append('strength', $('outfitStrength').value);
  form.append('left', $('maskLeft').value);
  form.append('top', $('maskTop').value);
  form.append('right', $('maskRight').value);
  form.append('bottom', $('maskBottom').value);
  genBtn.disabled = true;
  genBtn.textContent = 'Starting…';
  try {
    const response = await fetch('/api/outfit', { method: 'POST', body: form });
    await applyStartResponse(response);
  } catch (err) {
    pushLog(`ERROR: ${err.message}`);
    alert(err.message);
    renderJob(currentJob);
  }
}

$('genForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (generateMode === 'outfit') return submitOutfit();
  if (Number($('frames').value) >= 401 && !confirm(`Video ${$('frames').value} frame bisa memakan waktu sangat lama di CPU 2 core. Lanjutkan?`)) return;
  if (configMode === 'preset') applyPreset();
  const width = Number($('width').value);
  const height = Number($('height').value);
  const validSize = Number.isInteger(width) && Number.isInteger(height)
    && width >= 256 && width <= 1024 && height >= 256 && height <= 1024
    && width % 16 === 0 && height % 16 === 0;
  if (!validSize) {
    alert('Ukuran harus antara 256–1024 px dan kelipatan 16.');
    return;
  }
  const payload = {
    prompt: $('prompt').value.trim(),
    negative: $('negative').value.trim(),
    frames: Number($('frames').value),
    steps: Number($('steps').value),
    cfg: Number($('cfg').value),
    width,
    height
  };
  if (generateMode === 'image') payload.frames = 1;
  else if (payload.frames < 2) payload.frames = 9;
  genBtn.disabled = true;
  genBtn.textContent = 'Starting…';
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await applyStartResponse(response);
  } catch (err) {
    pushLog(`ERROR: ${err.message}`);
    alert(err.message);
    renderJob(currentJob);
  }
});

stopBtn.addEventListener('click', async () => {
  if (!currentJob || !ACTIVE_STATUSES.includes(currentJob.status) || currentJob.status === 'stopping') return;
  if (!confirm(`Hentikan job ${currentJob.id}? Proses yang sudah berjalan akan dihentikan tanpa output akhir.`)) return;
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stopping…';
  try {
    const response = await fetch('/api/cancel', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'gagal menghentikan job');
    renderJob(data.job);
    pushLog(`stop requested · ${data.job.id}`);
  } catch (err) {
    pushLog(`ERROR: ${err.message}`);
    alert(err.message);
    renderJob(currentJob);
  }
});

for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    activeFilter = chip.dataset.filter;
    for (const c of document.querySelectorAll('.chip')) c.classList.toggle('active', c === chip);
    loadFiles(1);
  });
}

prevPage.addEventListener('click', () => loadFiles(currentPage - 1));
nextPage.addEventListener('click', () => loadFiles(currentPage + 1));
lightboxClose.addEventListener('click', () => lightbox.close());
let activePage = 'generate';
function applyPage() {
  const mobile = window.innerWidth <= 899;
  pageGenerate.classList.toggle('mobile-page-hidden', mobile && activePage !== 'generate');
  pageResults.classList.toggle('mobile-page-hidden', mobile && activePage !== 'results');
  for (const btn of sideLinks) btn.classList.toggle('active', btn.dataset.page === activePage);
}
function setSidebar(open) {
  document.body.classList.toggle('sidebar-open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  sidebar.setAttribute('aria-hidden', String(window.innerWidth > 899 ? false : !open));
  sidebarOverlay.hidden = !open;
}
function setPage(page) {
  activePage = page === 'results' ? 'results' : 'generate';
  applyPage();
  setSidebar(false);
}
menuBtn.addEventListener('click', () => setSidebar(!document.body.classList.contains('sidebar-open')));
sidebarClose.addEventListener('click', () => setSidebar(false));
sidebarOverlay.addEventListener('click', () => setSidebar(false));
for (const btn of sideLinks) btn.addEventListener('click', () => setPage(btn.dataset.page));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setSidebar(false); });
window.addEventListener('resize', () => { if (window.innerWidth > 899) setSidebar(false); applyPage(); sidebar.setAttribute('aria-hidden','false'); });
applyPage();
sidebar.setAttribute('aria-hidden', String(window.innerWidth > 899 ? false : true));

guideBtn.addEventListener('click', () => guideModal.showModal());
guideClose.addEventListener('click', () => guideModal.close());
guideModal.addEventListener('click', (event) => {
  const rect = guideModal.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) guideModal.close();
});
lightboxPrev.addEventListener('click', () => showLightbox(lightboxIndex - 1));
lightboxNext.addEventListener('click', () => showLightbox(lightboxIndex + 1));
zoomIn.addEventListener('click', () => setLightboxZoom(lightboxZoomIndex + 1));
zoomOut.addEventListener('click', () => setLightboxZoom(lightboxZoomIndex - 1));
lightbox.addEventListener('close', () => {
  lightboxMedia.textContent = '';
  lightboxCaption.textContent = '';
  lightboxDetails.textContent = '';
  resetLightboxZoom();
});
lightbox.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    showLightbox(lightboxIndex - 1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    showLightbox(lightboxIndex + 1);
  }
});

setInterval(async () => {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    clock.textContent = `up ${data.uptime}s`;
  } catch {
    clock.textContent = 'offline';
  }
}, 5000);

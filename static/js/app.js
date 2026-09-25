// fetchX - Video Downloader App
const SITEKEY = '0x4AAAAAAFBpHtmC3T9sG2Ei';
let currentFormat = 'video';
let cardData = [];
let turnstileToken = '';
let turnstileWidgetId = null;
let playlists = [];
let pendingRedownload = null;

// ── Download history (localStorage — last N entries, 1h server window) ──
const HISTORY_KEY = 'fetchx_history_v1';
const HISTORY_MAX = 12;
const LINK_TTL_MS = 3600 * 1000; // server deletes files after 1 hour

function loadHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function storeHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch {}
}

function addToHistory(entry) {
  const list = loadHistory().filter(e =>
    !(e.url === entry.url && e.format === entry.format && !!e.batch === !!entry.batch));
  list.unshift(entry);
  storeHistory(list);
  renderHistory();
}

function removeHistory(i) {
  const list = loadHistory();
  list.splice(i, 1);
  storeHistory(list);
  renderHistory();
}

function clearHistory() {
  storeHistory([]);
  renderHistory();
}

function historyExpired(e) {
  return !e.jobId || (Date.now() - e.ts) > LINK_TTL_MS;
}

function fmtAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

// Format selection
function setFormat(btn) {
  document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFormat = btn.dataset.format;
}

// URL parsing
function parseUrls(text) {
  return [...new Set(text.split(/[\s,]+/).map(u => u.trim()).filter(u => u.startsWith('http')))];
}

// Duration formatter
function fmtDur(s) {
  if (!s) return '';
  return `${Math.floor(s/60)}:${(Math.floor(s%60)).toString().padStart(2,'0')}`;
}

// HTML escape
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Friendly error messages
function friendlyError(err) {
  const map = {
    'Unsupported URL': 'This URL is not supported',
    'Video unavailable': 'Video is unavailable or private',
    'Private video': 'This video is private',
    'HTTP Error 403': 'Access denied by the platform',
    'HTTP Error 404': 'Video not found',
    'copyright': 'Video blocked due to copyright',
    'geo': 'Video not available in your region',
    'timed out': 'Request timed out',
    'network': 'Network error',
  };
  for (const [k, v] of Object.entries(map)) { if (err.includes(k)) return v; }
  return err.length > 80 ? err.slice(0, 80) + '...' : err;
}

// ── Paste button ──
function pasteFromClipboard() {
  const input = document.getElementById('url-input');

  // Try modern clipboard API first (works desktop + Android)
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(text => {
      if (text && text.trim().startsWith('http')) {
        input.value = text.trim();
        input.focus();
      } else {
        input.focus();
      }
    }).catch(() => {
      // Permission denied or not supported — focus input for manual paste
      input.focus();
    });
  } else {
    // Fallback: focus input for manual paste
    input.focus();
  }
}

// ── Turnstile ──
function onTurnstileSuccess(token) {
  turnstileToken = token;
  const text = document.querySelector('.turnstile-text');
  if (text) { text.textContent = 'Verified'; text.style.color = 'var(--success)'; }
  setTimeout(() => {
    document.getElementById('turnstile-container').classList.add('hidden');
    if (pendingRedownload) {
      const e = pendingRedownload;
      pendingRedownload = null;
      runRedownload(e);
    } else {
      go();
    }
  }, 300);
}

function onTurnstileExpired() {
  turnstileToken = '';
  const text = document.querySelector('.turnstile-text');
  if (text) { text.textContent = 'Expired — click Fetch again'; text.style.color = 'var(--error)'; }
}

function onTurnstileError() {
  turnstileToken = '';
  const text = document.querySelector('.turnstile-text');
  if (text) { text.textContent = 'Failed — click Fetch again'; text.style.color = 'var(--error)'; }
}

function showTurnstile() {
  const wrapper = document.getElementById('turnstile-container');
  wrapper.classList.remove('hidden');
  const text = wrapper.querySelector('.turnstile-text');
  if (text) { text.textContent = 'Complete the verification'; text.style.color = 'var(--fg-muted)'; }

  // Check if turnstile is loaded
  if (typeof turnstile === 'undefined') {
    if (text) { text.textContent = 'Loading... retry in a moment'; text.style.color = 'var(--error)'; }
    return;
  }

  // If already rendered, reset for fresh challenge
  if (turnstileWidgetId !== null) {
    try { turnstile.reset(turnstileWidgetId); return; } catch(e) { turnstileWidgetId = null; }
  }

  // Render new widget
  turnstileWidgetId = turnstile.render('#cf-widget', {
    sitekey: SITEKEY,
    theme: 'dark',
    size: 'normal',
    callback: onTurnstileSuccess,
    'expired-callback': onTurnstileExpired,
    'error-callback': onTurnstileError,
  });
}

// ── Fetch button ──
function handleFetch() {
  const input = document.getElementById('url-input');
  const urls = parseUrls(input.value);
  if (!urls.length) { input.focus(); return; }

  // Already verified — go directly
  if (turnstileToken) { go(); return; }

  // Show turnstile
  showTurnstile();
}

// ── Main fetch ──
function isPlaylistUrl(u) {
  try {
    const p = new URL(u);
    if (p.pathname === '/playlist') return true;
    // Watch URL with a list= param → treat as the single video, not the playlist
    if (p.searchParams.get('v')) return false;
    return p.searchParams.has('list');
  } catch { return /[?&]list=/.test(u); }
}

async function fetchInfoInto(idx) {
  const c = cardData[idx];
  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: c.url, token: turnstileToken }),
    });
    const data = await res.json();
    if (data.error) {
      c.status = 'info-error';
      c.error = data.error;
    } else {
      c.status = 'ready';
      c.title = data.title || '';
      c.thumbnail = data.thumbnail || '';
      c.duration = data.duration;
      c.uploader = data.uploader || '';
      c.formats = data.formats || [];
      c.selectedFormatId = c.formats[0]?.id || null;
      c.subLangs = data.subtitles || [];
      c.subOpen = false;
      c.selectedSubLang = pickDefaultSub(c.subLangs);
    }
  } catch (e) {
    c.status = 'info-error';
    c.error = e.message;
  }
  renderCard(idx);
}

function newCard(data) {
  document.getElementById('results-section').classList.remove('hidden');
  const idx = cardData.length;
  cardData.push(data);
  renderCard(idx);
  return idx;
}

function pushErrorCard(url, error) {
  document.getElementById('results-section').classList.remove('hidden');
  const idx = cardData.length;
  cardData.push({ url, status: 'info-error', error });
  renderCard(idx);
}

// ── Playlist summary bar + ZIP batch ──
function renderPlaylistBars() {
  const host = document.getElementById('playlist-bars');
  if (!host) return;
  host.innerHTML = playlists.map((p, i) => `
    <div class="playlist-bar">
      <div class="pl-info">
        <i class="ph ph-stack"></i>
        <div style="min-width:0">
          <div class="pl-title">${esc((p.title || 'Playlist').slice(0, 70))}</div>
          <div class="pl-meta">${p.entries.length} video${p.entries.length === 1 ? '' : 's'}</div>
        </div>
      </div>
      <div class="pl-actions">
        <button class="pl-btn primary" id="pl-zip-${i}" onclick="batchDownload(${i})"><i class="ph ph-file-zip"></i> Download all as ZIP</button>
        <button class="pl-btn" id="pl-show-${i}" onclick="showPlaylistVideos(${i})">Show videos</button>
      </div>
    </div>`).join('');
}

async function showPlaylistVideos(i) {
  const p = playlists[i];
  if (!p || p.expanded) return;
  p.expanded = true;
  const btn = document.getElementById(`pl-show-${i}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  for (const entry of p.entries.slice(0, 40)) {
    const idx = newCard({ url: entry.url, status: 'loading' });
    await fetchInfoInto(idx);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Show videos'; }
  if (cardData.filter(c => c.status === 'ready').length > 1) renderDownloadAll();
}

async function batchDownload(i) {
  const p = playlists[i];
  if (!p) return;
  const urls = p.entries.map(e => e.url).filter(Boolean).slice(0, 40);
  if (!urls.length) return;
  const btn = document.getElementById(`pl-zip-${i}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
  try {
    const res = await fetch('/api/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, format: currentFormat, title: p.title, token: turnstileToken }),
    });
    const data = await res.json();
    if (data.error) { pushErrorCard(p.source, data.error); return; }
    const countLabel = p.entries.length > urls.length
      ? `${urls.length} of ${p.entries.length} videos`
      : `${urls.length} videos`;
    const idx = newCard({
      url: p.source, status: 'downloading', jobId: data.job_id,
      title: `${p.title || 'Playlist'} (${countLabel})`,
      isBatch: true, dlFormat: currentFormat, batchUrls: urls,
    });
    pollCard(idx);
  } catch (e) {
    pushErrorCard(p.source, e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-file-zip"></i> Download all as ZIP'; }
  }
}

async function go() {
  const urls = parseUrls(document.getElementById('url-input').value);
  if (!urls.length) return;

  const btn = document.getElementById('fetch-btn');
  const container = document.getElementById('cards');
  const resultsSection = document.getElementById('results-section');

  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Loading...';
  btn.querySelector('.btn-spinner').classList.remove('hidden');
  resultsSection.classList.remove('hidden');
  container.innerHTML = '';
  const plHost = document.getElementById('playlist-bars');
  if (plHost) plHost.innerHTML = '';
  playlists = [];
  cardData = [];

  const directUrls = [];
  const playlistUrls = [];
  urls.forEach(u => (isPlaylistUrl(u) ? playlistUrls : directUrls).push(u));

  // Resolve playlists → summary bar (per-video cards available on demand)
  for (const purl of playlistUrls) {
    try {
      const res = await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: purl, token: turnstileToken }),
      });
      const data = await res.json();
      const entries = (Array.isArray(data.entries) && data.entries.length)
        ? data.entries
        : (Array.isArray(data.urls) ? data.urls.map(u => ({ url: u, title: '' })) : []);
      if (data.error || !entries.length) {
        pushErrorCard(purl, data.error || 'No videos found in this playlist');
      } else {
        playlists.push({ title: data.title || 'Playlist', entries, source: purl });
      }
    } catch (e) {
      pushErrorCard(purl, e.message);
    }
  }
  renderPlaylistBars();

  // Fetch info for direct URLs
  for (const url of directUrls) {
    const idx = newCard({ url, status: 'loading' });
    await fetchInfoInto(idx);
  }

  if (cardData.filter(c => c.status === 'ready').length > 1) renderDownloadAll();

  btn.disabled = false;
  btn.querySelector('.btn-text').textContent = 'Fetch Video';
  btn.querySelector('.btn-spinner').classList.add('hidden');
}

// ── Render card ──
function renderCard(idx) {
  const c = cardData[idx];
  let el = document.getElementById(`card-${idx}`);
  if (!el) {
    el = document.createElement('div');
    el.id = `card-${idx}`;
    el.className = 'card';
    document.getElementById('cards').appendChild(el);
  }

  if (c.status === 'loading') {
    el.className = 'card';
    el.innerHTML = `<div class="card-thumb loading"></div><div class="card-body"><div class="skeleton-line medium"></div><div class="skeleton-line short"></div></div>`;
    return;
  }

  if (c.status === 'info-error') {
    el.className = 'card card-error';
    // Truncate error message and URL for clean display
    const shortError = (c.error || 'Failed to fetch').slice(0, 80);
    const shortUrl = (c.url || '').slice(0, 50);
    el.innerHTML = `
      <div class="card-thumb"><div class="card-error-icon"><i class="ph ph-x-circle"></i></div></div>
      <div class="card-body">
        <div class="card-title" style="color:var(--error)">Could not fetch video</div>
        <div class="card-error-msg">${esc(shortError)}</div>
        <div class="card-error-url">${esc(shortUrl)}${shortUrl.length < (c.url||'').length ? '...' : ''}</div>
      </div>`;
    return;
  }

  el.className = 'card';
  const isAudio = currentFormat === 'audio';

  let thumbHtml;
  if (c.isBatch) {
    thumbHtml = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--accent);font-size:1.8rem"><i class="ph ph-file-zip"></i></div>`;
  } else if (isAudio) {
    thumbHtml = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--accent);font-size:1.8rem"><i class="ph ph-music-note"></i></div>`;
  } else if (c.thumbnail) {
    thumbHtml = `<img src="${c.thumbnail}" alt="" loading="lazy">`;
  } else {
    thumbHtml = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--fg-muted);font-size:1.8rem"><i class="ph ph-image"></i></div>`;
  }

  let qualityChips = '';
  if (!isAudio && c.formats?.length > 1) {
    qualityChips = c.formats.map(f =>
      `<button class="q-chip${f.id === c.selectedFormatId ? ' active' : ''}" onclick="pickFormat(${idx},'${f.id}')">${f.label}</button>`
    ).join('');
  }

  let actionHtml = '';
  if (c.status === 'ready') {
    actionHtml = `<button class="card-dl-btn" onclick="dlCard(${idx})">Download</button>${qualityChips}`;
    if (c.subLangs?.length) {
      if (c.subOpen) {
        actionHtml += `<span class="sub-picker">
          <select class="sub-select" onchange="cardData[${idx}].selectedSubLang=this.value">
            ${c.subLangs.map(l => `<option value="${l}"${l === c.selectedSubLang ? ' selected' : ''}>${esc(subLabel(l))}</option>`).join('')}
          </select>
          <button class="q-chip active" onclick="dlSubs(${idx})">Get</button>
          <button class="q-chip" onclick="cancelSubs(${idx})">✕</button>
        </span>`;
      } else {
        actionHtml += `<button class="card-cc-btn" onclick="openSubs(${idx})" title="Download subtitles / captions"><i class="ph ph-closed-captioning"></i> CC</button>`;
      }
    }
  } else if (c.status === 'downloading') {
    const pct = Math.round(c.progress || 0);
    const speed = c.speed ? formatSpeed(c.speed) : '';
    const eta = c.eta ? formatEta(c.eta) : '';
    const counter = c.files ? ` · ${c.file || 0}/${c.files}` : '';
    actionHtml = `
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-text">${pct}%${counter}${speed ? ' · ' + speed : ''}${eta ? ' · ' + eta : ''}</span>
      </div>`;
  } else if (c.status === 'merging') {
    actionHtml = `
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" style="width:99%"></div></div>
        <span class="progress-text">Merging...</span>
      </div>`;
  } else if (c.status === 'done') {
    actionHtml = `<button class="card-dl-btn done" onclick="saveCard(${idx})">Save</button>
      <button class="card-qr-btn" onclick="showCardQr(${idx})" title="QR code — scan with phone"><i class="ph ph-qr-code"></i></button>
      ${c.dlFormat === 'subs' && c.subLangs?.length ? `<button class="q-chip" onclick="dlCard(${idx})" title="Also download the video">+ Video</button>` : ''}
      <span class="card-status done">${esc(c.filename || '')}</span>`;
  } else if (c.status === 'error') {
    actionHtml = `<button class="card-dl-btn" onclick="retryCard(${idx})">Retry</button><span class="card-status error">${esc(friendlyError(c.error || 'Failed'))}</span>`;
  }

  // Truncate long titles for clean mobile display
  const maxTitleLen = 60;
  const displayTitle = (c.title || 'Untitled').length > maxTitleLen
    ? (c.title || 'Untitled').slice(0, maxTitleLen) + '...'
    : (c.title || 'Untitled');

  // Only show uploader (truncated) + duration
  const displayMeta = (c.uploader ? c.uploader.slice(0, 30) : '') + (c.duration ? ' · ' + fmtDur(c.duration) : '');

  el.innerHTML = `<div class="card-thumb">${thumbHtml}</div><div class="card-body"><div class="card-title">${esc(displayTitle)}</div><div class="card-meta">${esc(displayMeta)}</div><div class="card-actions">${actionHtml}</div></div>`;
}

function renderDownloadAll() {
  const existing = document.getElementById('dl-all-bar');
  if (existing) existing.remove();
  const bar = document.createElement('div');
  bar.id = 'dl-all-bar';
  bar.className = 'dl-all-bar';
  bar.innerHTML = `<button class="dl-all-btn" onclick="downloadAll()">Download All</button>`;
  document.getElementById('cards').appendChild(bar);
}

function pickFormat(idx, formatId) {
  cardData[idx].selectedFormatId = formatId;
  renderCard(idx);
}

async function startJob(idx, extra) {
  const c = cardData[idx];
  c.status = 'downloading'; c.error = null; renderCard(idx);
  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: c.url, title: c.title || '', token: turnstileToken, ...extra }),
    });
    const data = await res.json();
    if (data.error) { c.status = 'error'; c.error = data.error; renderCard(idx); return; }
    c.jobId = data.job_id; pollCard(idx);
  } catch(e) { c.status = 'error'; c.error = e.message; renderCard(idx); }
}

function dlCard(idx) {
  const c = cardData[idx];
  c.want = 'video';
  c.dlFormat = currentFormat;
  return startJob(idx, { format: currentFormat, format_id: c.selectedFormatId });
}

function dlSubs(idx, lang) {
  const c = cardData[idx];
  const language = lang || c.selectedSubLang || pickDefaultSub(c.subLangs);
  if (!language) return;
  c.want = 'subs';
  c.dlFormat = 'subs';
  c.dlLang = language;
  c.subOpen = false;
  return startJob(idx, { format: 'subs', lang: language });
}

function retryCard(idx) {
  const c = cardData[idx];
  if (c.want === 'subs') return dlSubs(idx);
  return dlCard(idx);
}

// ── Subtitle language helpers ──
const SUB_LABELS = {
  en: 'English', 'en-US': 'English (US)', es: 'Spanish', fr: 'French',
  de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
  ja: 'Japanese', ko: 'Korean', hi: 'Hindi', ar: 'Arabic', tr: 'Turkish',
  nl: 'Dutch', pl: 'Polish', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai',
  uk: 'Ukrainian', zh: 'Chinese', 'zh-Hans': 'Chinese (Simplified)',
  'zh-Hant': 'Chinese (Traditional)',
};

function subLabel(code) {
  return SUB_LABELS[code] || SUB_LABELS[String(code).split('-')[0]] || code;
}

function pickDefaultSub(langs) {
  if (!langs?.length) return null;
  return langs.find(l => l === 'en')
    || langs.find(l => String(l).startsWith('en'))
    || langs[0];
}

function openSubs(idx) { cardData[idx].subOpen = true; renderCard(idx); }
function cancelSubs(idx) { cardData[idx].subOpen = false; renderCard(idx); }

function pollCard(idx) {
  const c = cardData[idx];
  const iv = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${c.jobId}`);
      const data = await res.json();
      if (data.status === 'done') {
        clearInterval(iv);
        c.status = 'done';
        c.filename = data.filename;
        c.progress = 100;
        renderCard(idx);
        recordHistory(c);
      } else if (data.status === 'downloading') {
        c.status = 'downloading';
        c.progress = data.progress || 0;
        c.speed = data.speed;
        c.eta = data.eta;
        c.file = data.file;
        c.files = data.files;
        renderCard(idx);
      } else if (data.status === 'merging') {
        c.status = 'merging';
        c.progress = 99;
        renderCard(idx);
      } else if (data.status === 'error') {
        clearInterval(iv);
        c.status = 'error';
        c.error = data.error;
        renderCard(idx);
      }
    } catch { clearInterval(iv); c.status = 'error'; c.error = 'Connection lost'; renderCard(idx); }
  }, 500);
}

function triggerFile(jobId, filename) {
  // Hidden link click — works on Safari, no popup blocker
  const a = document.createElement('a');
  a.href = `/api/file/${jobId}`;
  a.download = filename || 'download';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 100);
}

function saveCard(idx) {
  const c = cardData[idx];
  if (c.jobId) triggerFile(c.jobId, c.filename);
}

// ── History rendering + re-download ──
function recordHistory(c) {
  if (!c.jobId) return;
  const entry = {
    url: c.url || '',
    title: c.title || c.filename || 'Download',
    format: c.dlFormat || 'video',
    lang: c.dlLang || '',
    filename: c.filename || '',
    jobId: c.jobId,
    thumb: c.thumbnail || '',
    batch: !!c.isBatch,
    urls: c.isBatch ? (c.batchUrls || []) : null,
    ts: Date.now(),
  };
  if (!entry.url && !(entry.urls && entry.urls.length)) return;
  addToHistory(entry);
}

function fmtBadge(e) {
  if (e.batch) return 'ZIP';
  if (e.format === 'audio') return 'MP3';
  if (e.format === 'subs') return 'Subtitles';
  return 'MP4';
}

function renderHistory() {
  const section = document.getElementById('history-section');
  const wrap = document.getElementById('history-list');
  if (!section || !wrap) return;
  const list = loadHistory();
  if (!list.length) { section.classList.add('hidden'); wrap.innerHTML = ''; return; }
  section.classList.remove('hidden');

  wrap.innerHTML = list.map((e, i) => {
    const expired = historyExpired(e);
    const title = (e.title || 'Download').slice(0, 60);
    const thumb = e.thumb
      ? `<img src="${esc(e.thumb)}" alt="" loading="lazy">`
      : `<div class="hist-thumb-icon"><i class="ph ${e.batch ? 'ph-file-zip' : e.format === 'subs' ? 'ph-closed-captioning' : e.format === 'audio' ? 'ph-music-note' : 'ph-video'}"></i></div>`;
    const actions = expired
      ? `<button class="card-dl-btn" onclick="historyRedownload(${i})">Re-download</button>
         <span class="hist-badge">expired</span>`
      : `<button class="card-dl-btn done" onclick="historyOpen(${i})">Save</button>
         <button class="card-qr-btn" onclick="historyQr(${i})" title="QR code — scan with phone"><i class="ph ph-qr-code"></i></button>
         <button class="q-chip" onclick="historyRedownload(${i})" title="Start a fresh download">Fresh copy</button>`;
    return `<div class="card">
      <div class="card-thumb">${thumb}</div>
      <div class="card-body">
        <div class="card-title">${esc(title)}</div>
        <div class="card-meta">${fmtBadge(e)} · ${fmtAgo(e.ts)}${expired ? '' : ' · link valid 1h'}</div>
        <div class="card-actions">${actions}
          <button class="hist-remove" onclick="removeHistory(${i})" title="Remove from history"><i class="ph ph-x"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function historyOpen(i) {
  const e = loadHistory()[i];
  if (!e || !e.jobId) return;
  try {
    const res = await fetch(`/api/status/${e.jobId}`);
    const data = await res.json();
    if (data.status === 'done') { triggerFile(e.jobId, data.filename || e.filename); return; }
  } catch {}
  // File is gone (1h cleanup) — fall back to a fresh run
  historyRedownload(i);
}

function historyQr(i) {
  const e = loadHistory()[i];
  if (e && e.jobId) openQr(`${location.origin}/api/file/${e.jobId}`, e.filename || e.title || '');
}

async function historyRedownload(i) {
  const e = loadHistory()[i];
  if (!e) return;
  if (!e.batch && !e.url) return;
  if (!turnstileToken) { pendingRedownload = e; showTurnstile(); return; }
  await runRedownload(e);
}

function applyFormat(fmt) {
  if (fmt !== 'video' && fmt !== 'audio') return;
  const btn = document.querySelector(`.format-btn[data-format="${fmt}"]`);
  if (btn) setFormat(btn);
}

async function runRedownload(e) {
  applyFormat(e.format);
  document.getElementById('results-section').classList.remove('hidden');
  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (e.batch && e.urls && e.urls.length) {
    const idx = newCard({ url: e.url, status: 'downloading', title: e.title,
                          isBatch: true, dlFormat: e.format, batchUrls: e.urls });
    try {
      const res = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: e.urls, format: e.format, title: e.title, token: turnstileToken }),
      });
      const data = await res.json();
      if (data.error) { const c = cardData[idx]; c.status = 'error'; c.error = data.error; renderCard(idx); return; }
      cardData[idx].jobId = data.job_id;
      pollCard(idx);
    } catch (err) { const c = cardData[idx]; c.status = 'error'; c.error = err.message; renderCard(idx); }
    return;
  }

  const idx = newCard({ url: e.url, status: 'loading' });
  await fetchInfoInto(idx);
  const c = cardData[idx];
  if (c.status !== 'ready') return;
  if (e.format === 'subs') dlSubs(idx, e.lang);
  else dlCard(idx);
}

// ── QR code modal ──
let qrLibPromise = null;
function loadQrLib() {
  if (typeof qrcode === 'function') return Promise.resolve();
  if (!qrLibPromise) {
    qrLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
      s.onload = () => resolve();
      s.onerror = () => { qrLibPromise = null; reject(new Error('QR library failed to load')); };
      document.head.appendChild(s);
    });
  }
  return qrLibPromise;
}

function openQr(text, label) {
  const modal = document.getElementById('qr-modal');
  const box = document.getElementById('qr-box');
  const labelEl = document.getElementById('qr-label');
  if (!modal || !box) return;
  modal.classList.remove('hidden');
  if (labelEl) labelEl.textContent = label || '';
  box.innerHTML = '<div class="qr-loading">Generating…</div>';
  loadQrLib().then(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    box.innerHTML = qr.createSvgTag(6, 8);
  }).catch(() => {
    box.innerHTML = '<div class="qr-loading error">Could not generate QR code</div>';
  });
}

function showCardQr(idx) {
  const c = cardData[idx];
  if (c && c.jobId) openQr(`${location.origin}/api/file/${c.jobId}`, c.filename || c.title || '');
}

function closeQr() {
  const modal = document.getElementById('qr-modal');
  if (modal) modal.classList.add('hidden');
  const box = document.getElementById('qr-box');
  if (box) box.innerHTML = '';
}

function qrBackdrop(ev) { if (ev.target.id === 'qr-modal') closeQr(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQr(); });

async function downloadAll() {
  const btn = document.querySelector('.dl-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Downloading...'; }
  for (let i = 0; i < cardData.length; i++) {
    if (cardData[i].status === 'ready') await dlCard(i);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Download All'; }
}

// Format speed
function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return '';
  if (bytesPerSec > 1048576) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
  return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
}

// Format ETA
function formatEta(seconds) {
  if (!seconds) return '';
  if (seconds < 60) return seconds + 's';
  return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
}

// Enter key
document.getElementById('url-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFetch(); }
});

// Initial history render
renderHistory();

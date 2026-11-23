const VALID_CODES = [
  "NOELCOURSE-qG7dUZZi-oeKpAM7",
  "NOELCOURSE-Xx_kjJu6lDIcdLx7",
  "NOELCOURSE-MbnEP4smjpX7Ylsb",
  "NOELCOURSE-7rlCxA1kbp8g2Sa8",
  "NOELCOURSE-kkSqbHQUFCVaaIBN",
  "NOELCOURSE-o1jBnn3I-UJ9U3yB",
  "NOELCOURSE-izTdrsLD2fgECvio",
  "NOELCOURSE-pasFw_E1Ymk4cV2f",
  "NOELCOURSE-RoYAViUUDaIHJGWq",
  "NOELCOURSE-loipUa6HDkaQQbnQ",
  "NOELCOURSE-63cSBIRD5AztW1to",
  "NOELCOURSE-BSfNsZnejI58CNKX"
];

'use strict';
const GAME_MS = 3 * 60 * 1000;
const STORAGE_KEY = 'cherche-trouve-cours-etat-v1';
const $ = (id) => document.getElementById(id);
const screens = ['home','game','lost','win','clue'];
const validCodeIndex = new Map(VALID_CODES.map((code, index) => [code, index]));
let phase = 'home';
let deadline = 0;
let found = new Set();
let tickInterval = null;
let activeScanner = null;
let scannerSequence = 0;
let scanTaken = false;
let toastTimer = null;
let wakeLock = null;

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({phase, deadline, found: [...found], savedAt: Date.now()})); } catch (_) { }
}
function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    // Une nouvelle journée de jeu doit toujours revenir à l'accueil.
    if (!data || Date.now() - data.savedAt > 2 * 60 * 60 * 1000) return;
    if (!screens.includes(data.phase)) return;
    deadline = Number(data.deadline) || 0;
    found = new Set((Array.isArray(data.found) ? data.found : []).filter(i => Number.isInteger(i) && i >= 0 && i < 12));
    phase = data.phase;
    if (phase === 'game' && Date.now() >= deadline) phase = 'lost';
  } catch (_) { phase = 'home'; found = new Set(); }
}
function showScreen(screen) {
  for (const s of screens) $('screen-'+s).hidden = (s !== screen);
}
function timeLeft() { return Math.max(0, deadline - Date.now()); }
function renderTimer() {
  const remaining = timeLeft();
  const seconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  $('timer').textContent = `${String(minutes).padStart(2,'0')}:${ss}`;
  $('timer').classList.toggle('warning', seconds <= 60 && seconds > 30);
  $('timer').classList.toggle('danger', seconds <= 30);
  if (phase === 'game' && remaining <= 0) lose();
}
function renderPuzzle() {
  const puzzle = $('puzzle');
  puzzle.replaceChildren();
  for (let i = 0; i < 12; i++) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'puzzle-tile' + (found.has(i) ? ' revealed' : '');
    if (found.has(i)) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      tile.style.backgroundPosition = `${(col / 3) * 100}% ${(row / 2) * 100}%`;
      tile.setAttribute('aria-label', `Morceau ${i+1} découvert`);
    } else {
      const pic = document.createElement('img');
      pic.src = './qr-appareil.svg';
      pic.alt = '';
      tile.appendChild(pic);
      tile.setAttribute('aria-label', 'Scanner un QR code');
    }
    // N'importe quelle case peut déclencher le prochain scan.
    tile.addEventListener('click', openScanner);
    puzzle.appendChild(tile);
  }
  $('progress-count').textContent = found.size;
}
function render() {
  showScreen(phase);
  if (phase === 'game') {
    renderPuzzle();
    renderTimer();
  }
}
function stopTicker() {
  if (tickInterval !== null) clearInterval(tickInterval);
  tickInterval = null;
}
async function enableWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { }
}
async function releaseWakeLock() {
  try { await wakeLock?.release(); } catch (_) { }
  wakeLock = null;
}
function newGame() {
  scannerSequence++;
  stopTicker();
  found = new Set();
  deadline = Date.now() + GAME_MS;
  phase = 'game';
  save();
  render();
  tickInterval = setInterval(renderTimer, 200);
  enableWakeLock();
}
function lose() {
  if (phase !== 'game') return;
  phase = 'lost';
  stopTicker();
  releaseWakeLock();
  save();
  closeScanner();
  render();
}
function win() {
  if (phase !== 'game') return;
  phase = 'win';
  stopTicker();
  releaseWakeLock();
  save();
  closeScanner();
  render();
}
function showClue() {
  if (phase !== 'win') return;
  phase = 'clue';
  save();
  render();
}
function toast(message) {
  const node = $('toast');
  node.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.textContent = ''; }, 2500);
}
function setScannerStatus(message) { $('scanner-status').textContent = message; }

function acceptScan(rawText, sequence) {
  if (phase !== 'game' || sequence !== scannerSequence || scanTaken) return;
  if (timeLeft() <= 0) { lose(); return; }
  const index = validCodeIndex.get(String(rawText || '').trim());
  if (index === undefined) {
    setScannerStatus('Ce QR code ne fait pas partie du jeu.');
    return;
  }
  scanTaken = true;
  if (found.has(index)) {
    closeScanner();
    toast('Ce QR code a déjà été découvert !');
    return;
  }
  found.add(index);
  save();
  renderPuzzle();
  if (found.size === 12) win();
  else closeScanner();
}

async function startWithHtml5Qrcode(sequence) {
  const reader = $('reader');
  const config = {verbose: false};
  if (typeof Html5QrcodeSupportedFormats !== 'undefined') config.formatsToSupport = [Html5QrcodeSupportedFormats.QR_CODE];
  const scanner = new Html5Qrcode('reader', config);
  const engine = {kind: 'html5', instance: scanner, startPromise: null};
  activeScanner = engine;
  engine.startPromise = scanner.start(
    {facingMode: 'environment'},
    {fps: 12, qrbox: (w,h) => {const s = Math.max(140, Math.min(280,Math.floor(Math.min(w,h)*.78)));return {width:s,height:s};}},
    text => acceptScan(text,sequence),
    () => {}
  );
  await engine.startPromise;
  if (sequence !== scannerSequence || phase !== 'game') { await stopEngine(engine); return; }
  setScannerStatus('Présente un QR code devant l’appareil photo.');
}

async function startWithNativeDetector(sequence) {
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.style.cssText = 'display:block;width:100%;max-height:60vh;object-fit:cover';
  $('reader').replaceChildren(video);
  const stream = await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
  const detector = new BarcodeDetector({formats:['qr_code']});
  const engine = {kind:'native', video, stream, timer:null};
  activeScanner = engine;
  video.srcObject = stream;
  await video.play();
  if (sequence !== scannerSequence || phase !== 'game') { await stopEngine(engine); return; }
  setScannerStatus('Présente un QR code devant l’appareil photo.');
  let busy = false;
  engine.timer = setInterval(async () => {
    if (busy || sequence !== scannerSequence || video.readyState < 2) return;
    busy = true;
    try {
      const result = await detector.detect(video);
      if (result.length) acceptScan(result[0].rawValue, sequence);
    } catch (_) { }
    busy = false;
  }, 130);
}
async function openScanner() {
  if (phase !== 'game') return;
  if (timeLeft() <= 0) { lose(); return; }
  if (!$('scanner-modal').hidden) return;
  $('scanner-modal').hidden = false;
  $('retry-camera').hidden = true;
  $('reader').replaceChildren();
  setScannerStatus('Ouverture de l’appareil photo…');
  scanTaken = false;
  const sequence = ++scannerSequence;
  try {
    if (typeof Html5Qrcode === 'function') await startWithHtml5Qrcode(sequence);
    else if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia) await startWithNativeDetector(sequence);
    else throw new Error('Scanner indisponible');
  } catch (e) {
    if (sequence !== scannerSequence) return;
    if (activeScanner) { const old = activeScanner; activeScanner = null; await stopEngine(old); }
    if (sequence !== scannerSequence) return;
    setScannerStatus('Impossible d’ouvrir la caméra. Autorise son accès dans ton navigateur puis réessaie.');
    $('retry-camera').hidden = false;
  }
}
async function stopEngine(engine) {
  if (!engine) return;
  try {
    if (engine.kind === 'html5') {
      try { await engine.startPromise; } catch (_) { }
      if (engine.instance.isScanning) await engine.instance.stop();
      try { engine.instance.clear(); } catch (_) { }
    } else if (engine.kind === 'native') {
      clearInterval(engine.timer);
      engine.stream.getTracks().forEach(t => t.stop());
      engine.video.srcObject = null;
    }
  } catch (_) {
    if (engine.kind === 'native') engine.stream?.getTracks().forEach(t => t.stop());
  }
}
function closeScanner() {
  scannerSequence++;
  $('scanner-modal').hidden = true;
  $('retry-camera').hidden = true;
  const old = activeScanner;
  activeScanner = null;
  // Le scanner est stoppé avant le prochain déclenchement par l'utilisateur.
  return stopEngine(old);
}
$('start-btn').addEventListener('click', newGame);
$('restart-btn').addEventListener('click', newGame);
$('thanks-btn').addEventListener('click', showClue);
$('close-scanner').addEventListener('click', closeScanner);
$('retry-camera').addEventListener('click', async () => {await closeScanner(); openScanner();});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && phase === 'game') {
    renderTimer();
    if (phase === 'game') enableWakeLock();
  }
});
restore();
render();
if (phase === 'game') tickInterval = setInterval(renderTimer, 200);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));

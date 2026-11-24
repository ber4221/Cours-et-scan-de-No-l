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
let successTimer = null;
let successAudioContext = null;

// Réveiller Web Audio au contact d'un bouton : requis par les navigateurs mobiles.
// Le son est entièrement synthétisé sur l'appareil, sans fichier ni réseau.
function prepareSuccessAudio() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!successAudioContext) successAudioContext = new Audio();
    if (successAudioContext.state === 'suspended') {
      successAudioContext.resume().catch(() => {});
    }
  } catch (_) { /* Un téléphone en silencieux reste pleinement jouable. */ }
}
function playSuccessSound() {
  try {
    prepareSuccessAudio();
    const ctx = successAudioContext;
    if (!ctx || ctx.state !== 'running') return;
    const start = ctx.currentTime + .01;
    // Un petit « ta-ding » ascendant, volontairement bref et agréable.
    for (const [pitch, delay, duration] of [[659.25, 0, .13], [987.77, .13, .32]]) {
      const osc = ctx.createOscillator();
      const envelope = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, start + delay);
      envelope.gain.setValueAtTime(.0001, start + delay);
      envelope.gain.exponentialRampToValueAtTime(.21, start + delay + .02);
      envelope.gain.exponentialRampToValueAtTime(.0001, start + delay + duration);
      osc.connect(envelope);
      envelope.connect(ctx.destination);
      osc.start(start + delay);
      osc.stop(start + delay + duration + .015);
    }
  } catch (_) { /* Le visuel de validation fonctionne toujours sans audio. */ }
}
function clearSuccessCheck() {
  if (successTimer !== null) clearTimeout(successTimer);
  successTimer = null;
  $('scan-success').hidden = true;
}
function showSuccessCheck(isLastPiece) {
  clearSuccessCheck();
  $('scan-success').hidden = false;
  successTimer = setTimeout(() => {
    successTimer = null;
    $('scan-success').hidden = true;
    // Au dernier QR code, on laisse d'abord voir le Père Noël entier et le ✓.
    if (isLastPiece && phase === 'win') render();
  }, 3000);
}

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
  prepareSuccessAudio();
  clearSuccessCheck();
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
// Interrompt immédiatement la partie et ramène à l'accueil.
// On remet à zéro le temps et les morceaux pour le prochain départ.
function abandonGame() {
  if (phase !== 'game') return;
  clearSuccessCheck();
  closeScanner();
  stopTicker();
  releaseWakeLock();
  found = new Set();
  deadline = 0;
  phase = 'home';
  clearTimeout(toastTimer);
  $('toast').textContent = '';
  save();
  render();
}
function lose() {
  if (phase !== 'game') return;
  clearSuccessCheck();
  phase = 'lost';
  stopTicker();
  releaseWakeLock();
  save();
  closeScanner();
  render();
}
function win(afterScan = false) {
  if (phase !== 'game') return;
  phase = 'win';
  stopTicker();
  releaseWakeLock();
  save();
  closeScanner();
  // Sur le dernier scan, garder le puzzle complet à l'écran pendant les 3 s du ✓.
  // Le résultat est déjà enregistré : actualiser la page n'annule pas la victoire.
  if (!afterScan) render();
}
function showClue() {
  if (phase !== 'win') return;
  phase = 'clue';
  save();
  render();
}
// Après la réussite et la lecture de l'indice, remettre le jeu à zéro.
// Revenir à l'accueil sans relancer le chrono ni redemander la caméra.
function resetAfterWin() {
  if (phase !== 'clue') return;
  clearSuccessCheck();
  closeScanner();
  stopTicker();
  releaseWakeLock();
  clearTimeout(toastTimer);
  $('toast').textContent = '';
  found = new Set();
  deadline = 0;
  phase = 'home';
  setCameraMessage('');
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

// Sur DÉMARRER, le navigateur affiche sa boîte d'autorisation native si
// l'accès à la caméra n'a pas encore été autorisé ou refusé définitivement.
// Les applications Web ne peuvent pas accorder une autorisation bloquée.
function cameraPermissionHelp() {
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return 'L’appareil photo est bloqué. Dans les réglages du site de ton navigateur, choisis Caméra → Autoriser, puis réessaie.';
  }
  return 'L’appareil photo est bloqué. Dans les paramètres du site de ton navigateur, choisis Caméra → Autoriser, puis réessaie.';
}
function setCameraMessage(message, isError = false) {
  const help = $('camera-help');
  help.hidden = !message;
  help.textContent = message;
  help.classList.toggle('error', isError);
}

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
  closeScanner();
  // Scanner fermé, le morceau est révélé ; on confirme pendant exactement 3 s.
  playSuccessSound();
  if (found.size === 12) win(true);
  showSuccessCheck(found.size === 12);
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
  // Le joueur peut repartir scanner immédiatement : aucune attente imposée.
  clearSuccessCheck();
  prepareSuccessAudio();
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
    setScannerStatus(cameraPermissionHelp());
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
// Un seul bouton DÉMARRER : la demande native « Autoriser la caméra ? »
// précède le lancement du chronomètre, et ne compte pas dans les 3 minutes.
async function startWhenCameraReady() {
  if (phase !== 'home') return;
  prepareSuccessAudio();
  const button = $('start-btn');
  if (button.disabled) return;
  button.disabled = true;
  setCameraMessage('');
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera API indisponible');
    }
    // Appel direct depuis l'action de l'utilisateur : le navigateur gère le
    // vrai consentement « Autoriser / Refuser », sans écran supplémentaire.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    stream.getTracks().forEach(track => track.stop());
    if (phase === 'home') newGame();
  } catch (error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
      setCameraMessage(cameraPermissionHelp(), true);
    } else {
      setCameraMessage('Impossible d’ouvrir l’appareil photo. Ouvre ce jeu dans Safari ou Chrome, puis réessaie.', true);
    }
  } finally {
    button.disabled = false;
  }
}
$('start-btn').addEventListener('click', startWhenCameraReady);
$('restart-btn').addEventListener('click', newGame);
$('abandon-btn').addEventListener('click', abandonGame);
$('abandon-from-scanner').addEventListener('click', abandonGame);
$('thanks-btn').addEventListener('click', showClue);
$('reset-after-win-btn').addEventListener('click', resetAfterWin);
$('close-scanner').addEventListener('click', closeScanner);
$('retry-camera').addEventListener('click', async () => {
  const button = $('retry-camera');
  button.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API indisponible');
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    stream.getTracks().forEach(track => track.stop());
    if (phase === 'game') { await closeScanner(); await openScanner(); }
  } catch (_) {
    setScannerStatus(cameraPermissionHelp());
  } finally { button.disabled = false; }
});
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

import { DrawingEngine } from './drawing-engine.js';
import { PeerHost } from './peer-host.js';
import QRCode from 'qrcode';

/* ── DOM refs ── */
const canvas = document.getElementById('drawing-canvas');
const container = document.getElementById('canvas-wrap');
const cursorRing = document.getElementById('cursor-ring');
const gridOverlay = document.getElementById('grid-overlay');

/* ── Drawing engine ── */
const engine = new DrawingEngine(canvas, container, {
  onHistoryChange: updateUndoRedo,
});

let gridOn = false;
let gridSize = 50;

/* ── Cursor ring ── */
container.addEventListener('pointermove', (e) => {
  const r = container.getBoundingClientRect();
  cursorRing.style.left = (e.clientX - r.left) + 'px';
  cursorRing.style.top = (e.clientY - r.top) + 'px';
  cursorRing.style.display = 'block';
});
container.addEventListener('pointerleave', () => cursorRing.style.display = 'none');

function setCursorSize(s) {
  cursorRing.style.width = s + 'px';
  cursorRing.style.height = s + 'px';
}

/* ── Toolbar wiring ── */
const drawBtn = document.getElementById('tool-draw');
const eraseBtn = document.getElementById('tool-erase');
const undoBtn = document.getElementById('tool-undo');
const redoBtn = document.getElementById('tool-redo');
const colorPicker = document.getElementById('color-picker');
const slider = document.getElementById('radius-slider');
const sliderVal = document.getElementById('radius-val');
const clearBtn = document.getElementById('tool-clear');

const toolBtns = [drawBtn, eraseBtn];
function setTool(btn, t) {
  toolBtns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  engine.setTool(t);
}

drawBtn.onclick = () => setTool(drawBtn, 'draw');
eraseBtn.onclick = () => setTool(eraseBtn, 'erase');
colorPicker.addEventListener('input', e => { engine.setColor(e.target.value); save('canvas_brush_color', e.target.value); });
undoBtn.onclick = () => engine.undo();
redoBtn.onclick = () => engine.redo();
clearBtn.onclick = () => engine.clear();

slider.addEventListener('input', e => {
  const s = +e.target.value;
  engine.setBrushSize(s);
  sliderVal.textContent = s;
  setCursorSize(s);
  save('canvas_brush_size', s);
});

function updateUndoRedo() {
  undoBtn.disabled = !engine.canUndo();
  redoBtn.disabled = !engine.canRedo();
}

/* ── Keyboard shortcuts ── */
document.addEventListener('keydown', e => {
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); engine.redo(); }
  else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); engine.undo(); }
  else if (e.key === 'd' && !e.ctrlKey && !e.metaKey) { drawBtn.click(); }
  else if (e.key === 'e' && !e.ctrlKey && !e.metaKey) { eraseBtn.click(); }
});

/* ── Paste to Chat ── */
const pasteBtn = document.getElementById('paste-btn');
const statusEl = document.getElementById('status');

async function pasteImage(dataUrl) {
  const response = await chrome.runtime.sendMessage({
    type: 'PASTE_IMAGE',
    imageData: dataUrl,
  });
  if (response && response.success) return true;
  throw new Error(response?.error || 'Failed');
}

pasteBtn.addEventListener('click', async () => {
  pasteBtn.disabled = true;
  setStatus('Pasting...', '');
  try {
    await pasteImage(engine.toDataURL());
    setStatus('Pasted!', 'success');
  } catch (e) {
    setStatus(e.message || 'Failed to paste', 'error');
  } finally {
    pasteBtn.disabled = false;
  }
});

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = (cls || '') + ' visible';
  if (cls === 'success' || cls === 'error') {
    setTimeout(() => { statusEl.className = ''; statusEl.textContent = ''; }, 2500);
  }
}

/* ── Settings dialog ── */
const settingsBtn = document.getElementById('tool-settings');
const settingsDialog = document.getElementById('settings-dialog');
const settingsClose = document.getElementById('settings-close');
const bgWhiteBtn = document.getElementById('bg-white');
const bgBlackBtn = document.getElementById('bg-black');
const gridToggle = document.getElementById('grid-toggle');

settingsBtn.onclick = () => settingsDialog.showModal();
settingsClose.onclick = () => settingsDialog.close();
settingsDialog.addEventListener('click', (e) => {
  if (e.target === settingsDialog) settingsDialog.close();
});

function setBg(bg, repaint) {
  engine.setBackground(bg, repaint);
  container.style.background = bg;
  if (bg === '#ffffff') {
    bgWhiteBtn.classList.add('selected');
    bgBlackBtn.classList.remove('selected');
    cursorRing.classList.remove('light');
  } else {
    bgBlackBtn.classList.add('selected');
    bgWhiteBtn.classList.remove('selected');
    cursorRing.classList.add('light');
  }
  updateGrid();
  save('canvas_bg_color', bg);
}

bgWhiteBtn.onclick = () => setBg('#ffffff', true);
bgBlackBtn.onclick = () => setBg('#000000', true);

const gridSizeSlider = document.getElementById('grid-size-slider');
const gridSizeVal = document.getElementById('grid-size-val');

gridToggle.onclick = () => {
  gridOn = !gridOn;
  gridToggle.classList.toggle('on', gridOn);
  updateGrid();
  save('canvas_grid', gridOn);
};

gridSizeSlider.addEventListener('input', (e) => {
  gridSize = +e.target.value;
  gridSizeVal.textContent = gridSize;
  updateGrid();
  save('canvas_grid_size', gridSize);
});

function updateGrid() {
  if (gridOn) {
    const c = engine.background === '#000000' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
    gridOverlay.style.backgroundImage =
      `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`;
    gridOverlay.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    gridOverlay.style.display = 'block';
  } else {
    gridOverlay.style.display = 'none';
  }
}

/* ── Share / Remote Drawing (PeerJS) ── */
const shareBtn = document.getElementById('tool-share');
const shareDialog = document.getElementById('share-dialog');
const shareClose = document.getElementById('share-close');
const shareStatus = document.getElementById('share-status');
const shareQrCanvas = document.getElementById('share-qr');
const shareLinkText = document.getElementById('share-link');
const shareCopyBtn = document.getElementById('share-copy');
const shareStopBtn = document.getElementById('share-stop');
const connectionDot = document.getElementById('connection-dot');

let peerHost = null;

shareBtn.onclick = () => {
  shareDialog.showModal();
  if (!peerHost || peerHost.getState() === 'idle' || peerHost.getState() === 'error') {
    startSharing();
  }
};
shareClose.onclick = () => shareDialog.close();
shareDialog.addEventListener('click', (e) => {
  if (e.target === shareDialog) shareDialog.close();
});

shareStopBtn.onclick = () => {
  if (peerHost) { peerHost.stop(); peerHost = null; }
  connectionDot.className = 'dot';
  shareQrCanvas.style.display = 'none';
  shareLinkText.textContent = '';
  shareCopyBtn.style.display = 'none';
  shareStopBtn.style.display = 'none';
  shareStatus.textContent = 'Sharing stopped.';
};

async function startSharing() {
  shareStatus.textContent = 'Starting...';
  shareQrCanvas.style.display = 'none';
  shareLinkText.textContent = '';
  shareCopyBtn.style.display = 'none';
  shareStopBtn.style.display = 'none';

  peerHost = new PeerHost({
    onStateChange: (state) => {
      switch (state) {
        case 'initializing':
          shareStatus.textContent = 'Starting...';
          connectionDot.className = 'dot';
          break;
        case 'ready':
          shareStatus.textContent = 'Scan QR code or open link on your phone:';
          shareStopBtn.style.display = 'inline-block';
          connectionDot.className = 'dot waiting';
          renderQR();
          break;
        case 'connected':
          shareStatus.textContent = 'Phone connected! Waiting for drawing...';
          connectionDot.className = 'dot connected';
          break;
        case 'transferring':
          shareStatus.textContent = 'Receiving drawing...';
          break;
        case 'error':
          shareStatus.textContent = 'Connection error. Try again.';
          connectionDot.className = 'dot';
          break;
      }
    },
    onImageReceived: async (dataUrl) => {
      try {
        await pasteImage(dataUrl);
        setStatus('Remote drawing pasted!', 'success');
      } catch (e) {
        setStatus(e.message || 'Failed to paste remote drawing', 'error');
      }
    },
    onError: (err) => {
      console.error('PeerHost error:', err);
    },
  });

  try {
    await peerHost.start();
  } catch (e) {
    shareStatus.textContent = 'Failed to start: ' + e.message;
  }
}

function renderQR() {
  const url = peerHost.getShareUrl();
  if (!url) return;

  shareLinkText.textContent = url;
  shareCopyBtn.style.display = 'inline-block';
  shareQrCanvas.style.display = 'block';

  QRCode.toCanvas(shareQrCanvas, url, {
    width: 180,
    margin: 2,
    color: { dark: '#e0e0e0', light: '#2a2a2a' },
  });
}

shareCopyBtn.onclick = () => {
  const url = peerHost?.getShareUrl();
  if (url) {
    navigator.clipboard.writeText(url).then(() => {
      shareCopyBtn.textContent = 'Copied!';
      setTimeout(() => { shareCopyBtn.textContent = 'Copy Link'; }, 1500);
    });
  }
};

/* ── Persistence ── */
function save(k, v) { chrome.storage?.local?.set({ [k]: v }).catch(() => {}); }

async function loadPrefs() {
  try {
    const p = await chrome.storage.local.get(['canvas_brush_size', 'canvas_brush_color', 'canvas_bg_color', 'canvas_grid', 'canvas_grid_size']);
    if (p.canvas_brush_size) { const s = +p.canvas_brush_size; engine.setBrushSize(s); slider.value = s; sliderVal.textContent = s; setCursorSize(s); }
    if (p.canvas_brush_color) { engine.setColor(p.canvas_brush_color); colorPicker.value = p.canvas_brush_color; }
    if (p.canvas_bg_color) { setBg(p.canvas_bg_color, false); }
    if (p.canvas_grid_size) { gridSize = +p.canvas_grid_size; gridSizeSlider.value = gridSize; gridSizeVal.textContent = gridSize; }
    if (p.canvas_grid) { gridOn = true; gridToggle.classList.add('on'); updateGrid(); }
  } catch {}
}

/* ── Init ── */
requestAnimationFrame(() => {
  engine.resize();
  engine.pushUndo();
  setCursorSize(engine.brushSize);
  loadPrefs();
  new ResizeObserver(() => engine.resize()).observe(container);
});

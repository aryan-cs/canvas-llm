import { DrawingEngine } from './drawing-engine.js';
import { PeerHost } from './peer-host.js';
import QRCode from 'qrcode';

/* ── DOM refs ── */
const canvas = document.getElementById('drawing-canvas');
const container = document.getElementById('canvas-wrap');
const cursorRing = document.getElementById('cursor-ring');
const gridOverlay = document.getElementById('grid-overlay');

/* ── Drawing engine ── */
let peerHost = null; // declared early for engine callback closure

const engine = new DrawingEngine(canvas, container, {
  gridOverlay,
  onHistoryChange: updateUndoRedo,
  onDrawEvent: (event) => {
    if (peerHost && peerHost.getState() === 'connected') {
      peerHost.sendDrawEvent(event);
    }
  },
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

function sendActionToRemote(action) {
  if (peerHost && peerHost.getState() === 'connected') {
    peerHost.sendAction(action);
  }
}

drawBtn.onclick = () => setTool(drawBtn, 'draw');
eraseBtn.onclick = () => setTool(eraseBtn, 'erase');
colorPicker.addEventListener('input', e => { engine.setColor(e.target.value); save('canvas_brush_color', e.target.value); });
undoBtn.onclick = () => { engine.undo(); sendActionToRemote('undo'); };
redoBtn.onclick = () => { engine.redo(); sendActionToRemote('redo'); };
clearBtn.onclick = () => { engine.clear(); sendActionToRemote('clear'); };

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

/* ── Trackpad zoom / pan ── */
let viewScale = 1;
let viewPanX = 0;
let viewPanY = 0;
let _suppressViewSync = false;

function sendViewToRemote() {
  // No-op: each device manages its own view (zoom/pan) independently.
  // Stroke coordinates are absolute canvas-local positions, so strokes
  // appear at the same canvas position on both devices regardless of view.
}

container.addEventListener('wheel', (e) => {
  e.preventDefault();

  if (e.ctrlKey || e.metaKey) {
    // Pinch-to-zoom on trackpad (browsers send ctrlKey + wheel for pinch)
    const r = container.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;

    const zoomFactor = Math.exp(-e.deltaY * 0.01);
    const newScale = viewScale * zoomFactor;

    // Zoom around cursor position
    viewPanX = mx - (mx - viewPanX) * (newScale / viewScale);
    viewPanY = my - (my - viewPanY) * (newScale / viewScale);
    viewScale = newScale;
  } else {
    // Two-finger scroll = pan
    viewPanX -= e.deltaX;
    viewPanY -= e.deltaY;
  }

  engine.setViewTransform(viewScale, viewPanX, viewPanY);
  // Read back values (may shift due to canvas expansion)
  viewScale = engine._viewScale;
  viewPanX = engine._viewPanX;
  viewPanY = engine._viewPanY;
  sendViewToRemote();
}, { passive: false });

// Double-click to reset zoom
container.addEventListener('dblclick', (e) => {
  if (viewScale !== 1) {
    e.preventDefault();
    viewScale = 1;
    viewPanX = 0;
    viewPanY = 0;
    engine.resetView();
    sendViewToRemote();
  }
});

/* ── Keyboard shortcuts ── */
document.addEventListener('keydown', e => {
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); engine.redo(); sendActionToRemote('redo'); }
  else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); engine.undo(); sendActionToRemote('undo'); }
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

let _suppressSettingsSync = false;
function sendSettingsToRemote() {
  if (_suppressSettingsSync) return;
  if (peerHost && peerHost.getState() === 'connected') {
    peerHost.sendSettings({ bg: engine.background, grid: gridOn, gridSize });
  }
}

bgWhiteBtn.onclick = () => { setBg('#ffffff', true); sendSettingsToRemote(); };
bgBlackBtn.onclick = () => { setBg('#000000', true); sendSettingsToRemote(); };

const gridSizeSlider = document.getElementById('grid-size-slider');
const gridSizeVal = document.getElementById('grid-size-val');

gridToggle.onclick = () => {
  gridOn = !gridOn;
  gridToggle.classList.toggle('on', gridOn);
  updateGrid();
  save('canvas_grid', gridOn);
  sendSettingsToRemote();
};

gridSizeSlider.addEventListener('input', (e) => {
  gridSize = +e.target.value;
  gridSizeVal.textContent = gridSize;
  updateGrid();
  save('canvas_grid_size', gridSize);
  sendSettingsToRemote();
});

function updateGrid() {
  engine.setGrid(gridOn, gridSize);
}

/* ── Share / Remote Drawing (PeerJS) — inside settings ── */
const shareStatus = document.getElementById('share-status');
const shareStartBtn = document.getElementById('share-start');
const shareActive = document.getElementById('share-active');
const shareQrCanvas = document.getElementById('share-qr');
const shareLinkText = document.getElementById('share-link');
const shareCopyBtn = document.getElementById('share-copy');
const shareStopBtn = document.getElementById('share-stop');
const connectionDot = document.getElementById('connection-dot');
const shareDot = document.getElementById('share-dot');

function setDots(cls) {
  connectionDot.className = 'dot' + (cls ? ' ' + cls : '');
  shareDot.className = 'dot' + (cls ? ' ' + cls : '');
}

shareStartBtn.onclick = () => {
  if (!peerHost || peerHost.getState() === 'idle' || peerHost.getState() === 'error') {
    startSharing();
  }
};

shareStopBtn.onclick = () => {
  if (peerHost) { peerHost.stop(); peerHost = null; }
  setDots('');
  shareActive.style.display = 'none';
  shareStartBtn.style.display = '';
  shareStatus.textContent = 'Draw from your phone and see it live here.';
};

async function startSharing() {
  shareStatus.textContent = 'Starting...';
  shareStartBtn.style.display = 'none';
  shareActive.style.display = 'none';

  peerHost = new PeerHost({
    onStateChange: (state) => {
      switch (state) {
        case 'initializing':
          shareStatus.textContent = 'Starting...';
          setDots('');
          break;
        case 'ready':
          shareStatus.textContent = 'Scan QR or open link on your phone:';
          setDots('waiting');
          renderQR();
          break;
        case 'connected':
          shareStatus.textContent = 'Phone connected! Drawing syncs live.';
          setDots('connected');
          break;
        case 'transferring':
          shareStatus.textContent = 'Receiving drawing...';
          break;
        case 'error':
          shareStatus.textContent = 'Connection error. Try again.';
          setDots('');
          shareActive.style.display = 'none';
          shareStartBtn.style.display = '';
          break;
      }
    },
    onDrawEvent: (event) => {
      engine.remoteStroke(event);
    },
    onAction: (action) => {
      if (action === 'undo') engine.undo();
      else if (action === 'redo') engine.redo();
      else if (action === 'clear') engine.clear();
    },
    onView: () => {
      // Ignored: views are independent per device.
    },
    onSettings: (settings) => {
      _suppressSettingsSync = true;
      if (settings.bg) setBg(settings.bg, true);
      if (settings.grid !== undefined) {
        gridOn = settings.grid;
        gridToggle.classList.toggle('on', gridOn);
        updateGrid();
        save('canvas_grid', gridOn);
      }
      if (settings.gridSize !== undefined) {
        gridSize = settings.gridSize;
        gridSizeSlider.value = gridSize;
        gridSizeVal.textContent = gridSize;
        updateGrid();
        save('canvas_grid_size', gridSize);
      }
      _suppressSettingsSync = false;
    },
    onRemoteConnected: () => {
      // Send current canvas state + settings (NOT view — each device manages its own).
      // Use CSS-resolution export so the remote interprets coords at the same CSS
      // scale regardless of dpr mismatch (iPhone dpr=3 vs Mac dpr=2 etc.)
      const settings = { bg: engine.background, grid: gridOn, gridSize };
      peerHost.sendInit(engine.toCssDataURL(), settings);
    },
    onPasteRequest: async () => {
      try {
        await pasteImage(engine.toDataURL());
        setStatus('Remote drawing pasted!', 'success');
      } catch (e) {
        setStatus(e.message || 'Failed to paste remote drawing', 'error');
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
    shareStartBtn.style.display = '';
  }
}

function renderQR() {
  const url = peerHost.getShareUrl();
  if (!url) return;

  shareLinkText.textContent = url;
  shareActive.style.display = '';

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

import { DrawingEngine } from '../src/drawing-engine.js';
import { PeerRemote } from '../src/peer-remote.js';

/* ── Parse peer ID from URL hash ── */
const params = new URLSearchParams(location.hash.slice(1));
const hostPeerId = params.get('peer');

const errorOverlay = document.getElementById('error-overlay');
const errorTitle = document.getElementById('error-title');
const errorMsg = document.getElementById('error-msg');

if (!hostPeerId) {
  errorTitle.textContent = 'No Connection ID';
  errorMsg.textContent = 'Open this page from the QR code or link in the Canvas extension. The URL should contain a connection ID.';
  errorOverlay.classList.remove('hidden');
}

/* ── DOM refs ── */
const canvas = document.getElementById('drawing-canvas');
const container = document.getElementById('canvas-wrap');
const gridOverlay = document.getElementById('grid-overlay');
const connectionDot = document.getElementById('connection-dot');
const sendBtn = document.getElementById('send-btn');
const drawBtn = document.getElementById('tool-draw');
const eraseBtn = document.getElementById('tool-erase');
const undoBtn = document.getElementById('tool-undo');
const redoBtn = document.getElementById('tool-redo');
const clearBtn = document.getElementById('tool-clear');
const colorPicker = document.getElementById('color-picker');
const slider = document.getElementById('radius-slider');
const sliderVal = document.getElementById('radius-val');
const toastEl = document.getElementById('status-toast');

/* ── PeerJS connection (declared early so engine callback can use it) ── */
let peer = null;

/* ── Drawing engine ── */
const engine = new DrawingEngine(canvas, container, {
  gridOverlay,
  onHistoryChange: updateUndoRedo,
  onDrawEvent: (event) => {
    if (peer && peer.getState() === 'connected') {
      peer.sendDrawEvent(event);
    }
  },
});

function updateUndoRedo() {
  undoBtn.disabled = !engine.canUndo();
  redoBtn.disabled = !engine.canRedo();
}

/* ── Toolbar wiring ── */
const toolBtns = [drawBtn, eraseBtn];
function setTool(btn, t) {
  toolBtns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  engine.setTool(t);
}

drawBtn.onclick = () => setTool(drawBtn, 'draw');
eraseBtn.onclick = () => setTool(eraseBtn, 'erase');
function sendActionToHost(action) {
  if (peer && peer.getState() === 'connected') {
    peer.sendAction(action);
  }
}

colorPicker.addEventListener('input', e => engine.setColor(e.target.value));
undoBtn.onclick = () => { engine.undo(); sendActionToHost('undo'); };
redoBtn.onclick = () => { engine.redo(); sendActionToHost('redo'); };
clearBtn.onclick = () => { engine.clear(); sendActionToHost('clear'); };

/* ── Settings sync helper ── */
let _suppressSettingsSync = false;
function sendSettingsToHost() {
  if (_suppressSettingsSync) return;
  if (peer && peer.getState() === 'connected') {
    peer.sendSettings({ bg: engine.background, grid: gridOn, gridSize });
  }
}

slider.addEventListener('input', e => {
  const s = +e.target.value;
  engine.setBrushSize(s);
  sliderVal.textContent = s;
});

/* ── Settings dialog ── */
const settingsBtn = document.getElementById('tool-settings');
const settingsDialog = document.getElementById('settings-dialog');
const settingsClose = document.getElementById('settings-close');
const bgWhiteBtn = document.getElementById('bg-white');
const bgBlackBtn = document.getElementById('bg-black');
const gridToggle = document.getElementById('grid-toggle');
const gridSizeSlider = document.getElementById('grid-size-slider');
const gridSizeVal = document.getElementById('grid-size-val');

let gridOn = false;
let gridSize = 50;

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
  } else {
    bgBlackBtn.classList.add('selected');
    bgWhiteBtn.classList.remove('selected');
  }
  updateGrid();
}

bgWhiteBtn.onclick = () => { setBg('#ffffff', true); sendSettingsToHost(); };
bgBlackBtn.onclick = () => { setBg('#000000', true); sendSettingsToHost(); };

gridToggle.onclick = () => {
  gridOn = !gridOn;
  gridToggle.classList.toggle('on', gridOn);
  updateGrid();
  sendSettingsToHost();
};

gridSizeSlider.addEventListener('input', (e) => {
  gridSize = +e.target.value;
  gridSizeVal.textContent = gridSize;
  updateGrid();
  sendSettingsToHost();
});

function updateGrid() {
  engine.setGrid(gridOn, gridSize);
}

/* ── Status toast ── */
function showToast(text, cls) {
  toastEl.textContent = text;
  toastEl.className = (cls || '') + ' visible';
  if (cls === 'success' || cls === 'error') {
    setTimeout(() => { toastEl.className = ''; toastEl.textContent = ''; }, 2500);
  }
}

/* ── Pinch-to-zoom / two-finger pan ── */
let gestureActive = false;
let lastTouches = null;
let viewScale = 1;
let viewPanX = 0;
let viewPanY = 0;
let _suppressViewSync = false;

function sendViewToHost() {
  if (_suppressViewSync) return;
  if (peer && peer.getState() === 'connected') {
    const c = engine.getViewCenter();
    peer.sendView({ cx: c.x, cy: c.y, scale: c.scale });
  }
}

function getTouchData(touches) {
  const r = container.getBoundingClientRect();
  return Array.from(touches).map(t => ({
    x: t.clientX - r.left,
    y: t.clientY - r.top,
  }));
}

container.addEventListener('touchstart', (e) => {
  if (e.touches.length >= 2) {
    gestureActive = true;
    engine.paused = true;
    engine.cancelStroke();
    lastTouches = getTouchData(e.touches);
    e.preventDefault();
  }
}, { passive: false });

container.addEventListener('touchmove', (e) => {
  if (!gestureActive || e.touches.length < 2) return;
  e.preventDefault();

  const curr = getTouchData(e.touches);
  const prev = lastTouches;

  const prevDist = Math.hypot(prev[1].x - prev[0].x, prev[1].y - prev[0].y);
  const currDist = Math.hypot(curr[1].x - curr[0].x, curr[1].y - curr[0].y);

  const prevMidX = (prev[0].x + prev[1].x) / 2;
  const prevMidY = (prev[0].y + prev[1].y) / 2;
  const currMidX = (curr[0].x + curr[1].x) / 2;
  const currMidY = (curr[0].y + curr[1].y) / 2;

  // Scale change
  const ds = prevDist > 0 ? currDist / prevDist : 1;
  const newScale = viewScale * ds;

  // Zoom around the midpoint + pan with midpoint movement
  viewPanX = currMidX - (prevMidX - viewPanX) * (newScale / viewScale);
  viewPanY = currMidY - (prevMidY - viewPanY) * (newScale / viewScale);
  viewScale = newScale;

  engine.setViewTransform(viewScale, viewPanX, viewPanY);
  // Read back values (may shift due to canvas expansion)
  viewScale = engine._viewScale;
  viewPanX = engine._viewPanX;
  viewPanY = engine._viewPanY;
  sendViewToHost();
  lastTouches = curr;
}, { passive: false });

container.addEventListener('touchend', (e) => {
  if (gestureActive && e.touches.length < 2) {
    gestureActive = false;
    lastTouches = null;
    // Brief delay before re-enabling drawing to prevent accidental stroke
    setTimeout(() => { engine.paused = false; }, 80);
  }
});

/* ── Prevent iOS bounce (single-finger on canvas handled by engine, block the rest) ── */
document.addEventListener('touchmove', (e) => {
  if (e.target === canvas || container.contains(e.target)) {
    if (!gestureActive) e.preventDefault();
  }
}, { passive: false });

/* ── PeerJS connection ── */
function setConnectionStatus(state) {
  connectionDot.className = state || '';
}

function applySettings(settings) {
  _suppressSettingsSync = true;
  if (settings.bg) setBg(settings.bg, true);
  if (settings.grid !== undefined) {
    gridOn = settings.grid;
    gridToggle.classList.toggle('on', gridOn);
    updateGrid();
  }
  if (settings.gridSize !== undefined) {
    gridSize = settings.gridSize;
    gridSizeSlider.value = gridSize;
    gridSizeVal.textContent = gridSize;
    updateGrid();
  }
  _suppressSettingsSync = false;
}

function applyInitStrokes(strokes) {
  if (!strokes) return;
  engine.loadStrokes(strokes);
}

async function connectToPeer() {
  if (!hostPeerId) return;

  setConnectionStatus('connecting');

  peer = new PeerRemote(hostPeerId, {
    onStateChange: (state) => {
      switch (state) {
        case 'connecting':
          setConnectionStatus('connecting');
          break;
        case 'connected':
          setConnectionStatus('connected');
          sendBtn.disabled = false;
          break;
        case 'sending':
          setConnectionStatus('connected');
          break;
        case 'disconnected':
          setConnectionStatus('');
          sendBtn.disabled = true;
          break;
        case 'error':
          setConnectionStatus('error');
          sendBtn.disabled = true;
          break;
      }
    },
    onAck: () => {
      sendBtn.disabled = false;
    },
    onPasteAck: () => {
      showToast('Pasted into chat!', 'success');
      sendBtn.disabled = false;
    },
    onAction: (action) => {
      if (action === 'undo') engine.undo();
      else if (action === 'redo') engine.redo();
      else if (action === 'clear') engine.clear();
    },
    onDrawEvent: (event) => {
      engine.remoteStroke(event);
    },
    onSettings: (settings) => {
      applySettings(settings);
    },
    onView: (view) => {
      if (!view || typeof view.cx !== 'number') return;
      _suppressViewSync = true;
      engine.setViewCenter(view.cx, view.cy, view.scale);
      // Mirror engine state into local view variables used by gesture handlers
      viewScale = engine._viewScale;
      viewPanX = engine._viewPanX;
      viewPanY = engine._viewPanY;
      _suppressViewSync = false;
    },
    onInit: (strokes, settings) => {
      if (settings) applySettings(settings);
      if (strokes) applyInitStrokes(strokes);
    },
    onError: (err) => {
      console.error('PeerRemote error:', err);
    },
  });

  try {
    await peer.connect();
  } catch (e) {
    setConnectionStatus('error');
    errorTitle.textContent = 'Connection Failed';
    errorMsg.textContent = 'Could not connect to the extension. Make sure the sharing session is still active and try scanning the QR code again.';
    errorOverlay.classList.remove('hidden');
  }
}

/* ── Send = capture remote's current viewport, ship blob to host for paste ── */
sendBtn.onclick = async () => {
  if (!peer || peer.getState() !== 'connected') return;
  sendBtn.disabled = true;
  showToast('Sending...', '');
  try {
    const blob = await engine.toBlob();
    if (!blob) throw new Error('Failed to capture canvas');
    await peer.sendImage(blob);
    // onAck / onPasteAck callbacks re-enable the button.
  } catch (e) {
    showToast('Failed: ' + (e.message || 'send error'), 'error');
    sendBtn.disabled = false;
  }
};

/* ── Init ── */
requestAnimationFrame(() => {
  engine.resize();
  engine.pushUndo();
  new ResizeObserver(() => engine.resize()).observe(container);
  connectToPeer();
});

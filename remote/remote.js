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
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-btn');
const drawBtn = document.getElementById('tool-draw');
const eraseBtn = document.getElementById('tool-erase');
const undoBtn = document.getElementById('tool-undo');
const redoBtn = document.getElementById('tool-redo');
const colorPicker = document.getElementById('color-picker');
const slider = document.getElementById('radius-slider');
const sliderVal = document.getElementById('radius-val');

/* ── Drawing engine ── */
const engine = new DrawingEngine(canvas, container, {
  onHistoryChange: updateUndoRedo,
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
colorPicker.addEventListener('input', e => engine.setColor(e.target.value));
undoBtn.onclick = () => engine.undo();
redoBtn.onclick = () => engine.redo();
clearBtn.onclick = () => engine.clear();

slider.addEventListener('input', e => {
  const s = +e.target.value;
  engine.setBrushSize(s);
  sliderVal.textContent = s;
});

/* ── Prevent iOS bounce/zoom ── */
document.addEventListener('touchmove', (e) => {
  if (e.target === canvas || container.contains(e.target)) {
    e.preventDefault();
  }
}, { passive: false });

/* ── PeerJS connection ── */
let peer = null;

function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = text;
}

async function connectToPeer() {
  if (!hostPeerId) return;

  setStatus('connecting', 'Connecting...');

  peer = new PeerRemote(hostPeerId, {
    onStateChange: (state) => {
      switch (state) {
        case 'connecting':
          setStatus('connecting', 'Connecting...');
          break;
        case 'connected':
          setStatus('connected', 'Connected');
          sendBtn.disabled = false;
          break;
        case 'sending':
          setStatus('connected', 'Sending...');
          break;
        case 'disconnected':
          setStatus('', 'Disconnected');
          sendBtn.disabled = true;
          break;
        case 'error':
          setStatus('error', 'Connection lost');
          sendBtn.disabled = true;
          break;
      }
    },
    onAck: () => {
      setStatus('connected', 'Sent! Draw another or close this page.');
      sendBtn.disabled = false;
    },
    onError: (err) => {
      console.error('PeerRemote error:', err);
    },
  });

  try {
    await peer.connect();
  } catch (e) {
    setStatus('error', 'Failed to connect');
    errorTitle.textContent = 'Connection Failed';
    errorMsg.textContent = 'Could not connect to the extension. Make sure the sharing session is still active and try scanning the QR code again.';
    errorOverlay.classList.remove('hidden');
  }
}

/* ── Send drawing ── */
sendBtn.onclick = async () => {
  if (!peer || peer.getState() !== 'connected') return;
  sendBtn.disabled = true;
  setStatus('connected', 'Sending...');

  try {
    const blob = await engine.toBlob();
    await peer.sendImage(blob);
    setStatus('connected', 'Sent! Waiting for confirmation...');
  } catch (e) {
    setStatus('error', 'Failed to send: ' + e.message);
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

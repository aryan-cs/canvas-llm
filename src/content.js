import { PanelController } from './panel.js';

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH_RATIO = 0.5;
const STORAGE_KEYS = {
  side: 'canvas_panel_side',
  width: 'canvas_panel_width',
};

let host = null;
let shadowRoot = null;
let panelController = null;
let panelVisible = false;
let panelSide = 'right';
let panelWidth = DEFAULT_WIDTH;
let originalMargin = '';
let isResizing = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TOGGLE_PANEL') {
    toggle();
  }
});

async function toggle() {
  if (!host) {
    await createPanel();
  }

  panelVisible = !panelVisible;
  host.style.display = panelVisible ? 'block' : 'none';
  updatePageMargin();
}

async function createPanel() {
  host = document.createElement('div');
  host.id = 'canvas-ext-root';
  host.style.cssText = 'all: initial; display: none;';
  document.body.appendChild(host);

  shadowRoot = host.attachShadow({ mode: 'closed' });

  const [htmlRes, cssRes] = await Promise.all([
    fetch(chrome.runtime.getURL('panel.html')),
    fetch(chrome.runtime.getURL('panel.css')),
  ]);

  const htmlText = await htmlRes.text();
  const cssText = await cssRes.text();

  const style = document.createElement('style');
  style.textContent = cssText;
  shadowRoot.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = htmlText;
  while (wrapper.firstChild) {
    shadowRoot.appendChild(wrapper.firstChild);
  }

  await loadPrefs();
  applyPosition();

  panelController = new PanelController(shadowRoot, toggleSide);
  setupResize();
}

async function loadPrefs() {
  if (!chrome?.storage?.local) return;
  try {
    const prefs = await chrome.storage.local.get([STORAGE_KEYS.side, STORAGE_KEYS.width]);
    if (prefs[STORAGE_KEYS.side]) panelSide = prefs[STORAGE_KEYS.side];
    if (prefs[STORAGE_KEYS.width]) panelWidth = Number(prefs[STORAGE_KEYS.width]);
  } catch (e) {
    // use defaults
  }
}

function savePref(key, value) {
  if (!chrome?.storage?.local) return;
  chrome.storage.local.set({ [key]: value }).catch(() => {});
}

function applyPosition() {
  if (!host) return;
  const maxW = Math.floor(window.innerWidth * MAX_WIDTH_RATIO);
  panelWidth = Math.max(MIN_WIDTH, Math.min(panelWidth, maxW));

  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.height = '100vh';
  host.style.width = panelWidth + 'px';
  host.style.zIndex = '2147483647';

  if (panelSide === 'left') {
    host.style.left = '0';
    host.style.right = 'auto';
    shadowRoot.host.classList.add('panel-left');
  } else {
    host.style.right = '0';
    host.style.left = 'auto';
    shadowRoot.host.classList.remove('panel-left');
  }
}

function updatePageMargin() {
  if (panelVisible) {
    if (panelSide === 'right') {
      originalMargin = document.body.style.marginRight;
      document.body.style.marginRight = panelWidth + 'px';
      document.body.style.marginLeft = '';
    } else {
      originalMargin = document.body.style.marginLeft;
      document.body.style.marginLeft = panelWidth + 'px';
      document.body.style.marginRight = '';
    }
  } else {
    document.body.style.marginRight = '';
    document.body.style.marginLeft = '';
  }
}

function toggleSide() {
  panelSide = panelSide === 'right' ? 'left' : 'right';
  savePref(STORAGE_KEYS.side, panelSide);
  applyPosition();
  updatePageMargin();
}

function setupResize() {
  const handle = shadowRoot.getElementById('resize-handle');
  if (!handle) return;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isResizing = true;
    handle.classList.add('active');
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!isResizing) return;
    const maxW = Math.floor(window.innerWidth * MAX_WIDTH_RATIO);

    let newWidth;
    if (panelSide === 'right') {
      newWidth = window.innerWidth - e.clientX;
    } else {
      newWidth = e.clientX;
    }

    newWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxW));
    panelWidth = newWidth;
    host.style.width = panelWidth + 'px';
    updatePageMargin();
  });

  handle.addEventListener('pointerup', (e) => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('active');
    handle.releasePointerCapture(e.pointerId);
    savePref(STORAGE_KEYS.width, panelWidth);
  });
}

import { DrawingEngine } from './canvas.js';
import { getAdapter } from './adapters/index.js';

export class PanelController {
  constructor(shadowRoot, onPositionChange) {
    this.shadow = shadowRoot;
    this.onPositionChange = onPositionChange;
    this.engine = null;
    this.cursorPreview = null;

    this._init();
  }

  _init() {
    const canvas = this.shadow.getElementById('drawing-canvas');
    const container = this.shadow.getElementById('canvas-container');
    this.cursorPreview = this.shadow.getElementById('cursor-preview');

    this.engine = new DrawingEngine(canvas, container);
    this.engine.onHistoryChange = () => this._updateUndoRedo();

    this._bindTools();
    this._bindCursorPreview(container);
    this._bindAttach();
    this._bindKeyboard();
    this._loadPrefs();
  }

  _bindTools() {
    const drawBtn = this.shadow.getElementById('tool-draw');
    const fillBtn = this.shadow.getElementById('tool-fill');
    const eraseBtn = this.shadow.getElementById('tool-erase');
    const undoBtn = this.shadow.getElementById('tool-undo');
    const redoBtn = this.shadow.getElementById('tool-redo');
    const colorPicker = this.shadow.getElementById('color-picker');
    const radiusSlider = this.shadow.getElementById('radius-slider');
    const radiusValue = this.shadow.getElementById('radius-value');
    const clearBtn = this.shadow.getElementById('tool-clear');
    const posBtn = this.shadow.getElementById('tool-position');

    this.undoBtn = undoBtn;
    this.redoBtn = redoBtn;

    const toolBtns = [drawBtn, fillBtn, eraseBtn];

    const setActiveTool = (btn, tool) => {
      toolBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      this.engine.setTool(tool);
      this._updateCursorStyle(tool);
    };

    drawBtn.addEventListener('click', () => setActiveTool(drawBtn, 'draw'));
    fillBtn.addEventListener('click', () => setActiveTool(fillBtn, 'fill'));
    eraseBtn.addEventListener('click', () => setActiveTool(eraseBtn, 'erase'));

    undoBtn.addEventListener('click', () => this.engine.undo());
    redoBtn.addEventListener('click', () => this.engine.redo());

    colorPicker.addEventListener('input', (e) => {
      this.engine.setColor(e.target.value);
      this._savePref('canvas_brush_color', e.target.value);
    });

    radiusSlider.addEventListener('input', (e) => {
      const size = Number(e.target.value);
      this.engine.setBrushSize(size);
      radiusValue.textContent = size;
      this._updateCursorPreviewSize(size);
      this._savePref('canvas_brush_size', size);
    });

    clearBtn.addEventListener('click', () => this.engine.clear());

    posBtn.addEventListener('click', () => {
      if (this.onPositionChange) this.onPositionChange();
    });
  }

  _bindCursorPreview(container) {
    container.addEventListener('pointermove', (e) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.cursorPreview.style.left = x + 'px';
      this.cursorPreview.style.top = y + 'px';
      this.cursorPreview.style.display = 'block';
    });

    container.addEventListener('pointerleave', () => {
      this.cursorPreview.style.display = 'none';
    });

    this._updateCursorPreviewSize(this.engine.brushSize);
  }

  _updateCursorPreviewSize(size) {
    if (!this.cursorPreview) return;
    this.cursorPreview.style.width = size + 'px';
    this.cursorPreview.style.height = size + 'px';
  }

  _updateCursorStyle(tool) {
    const container = this.shadow.getElementById('canvas-container');
    if (tool === 'fill') {
      container.style.cursor = 'crosshair';
      this.cursorPreview.style.display = 'none';
    } else {
      container.style.cursor = 'none';
    }
  }

  _updateUndoRedo() {
    this.undoBtn.disabled = !this.engine.canUndo();
    this.redoBtn.disabled = !this.engine.canRedo();
  }

  // Attach-only: paste the canvas image into the site's chat input.
  // The user then types their own text and hits the site's own Send button.
  _bindAttach() {
    const attachBtn = this.shadow.getElementById('attach-btn');

    attachBtn.addEventListener('click', async () => {
      attachBtn.disabled = true;
      this._setStatus('Attaching...', '');

      try {
        const adapter = getAdapter();
        const blob = await this.engine.toBlob();

        await adapter.attachImage(blob);
        this._setStatus('Pasted to chat!', 'success');
      } catch (err) {
        console.error('[Canvas]', err);
        this._setStatus(err.message || 'Failed to paste', 'error');
      } finally {
        attachBtn.disabled = false;
      }
    });
  }

  _setStatus(text, className) {
    const statusMsg = this.shadow.getElementById('status-message');
    statusMsg.textContent = text;
    statusMsg.className = className || '';
    if (className === 'success') {
      setTimeout(() => {
        if (statusMsg.textContent === text) {
          statusMsg.textContent = '';
          statusMsg.className = '';
        }
      }, 3000);
    }
  }

  _bindKeyboard() {
    this.shadow.host.addEventListener('keydown', (e) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        this.engine.redo();
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.engine.undo();
      } else if (e.key === 'd' && !e.ctrlKey && !e.metaKey) {
        this.shadow.getElementById('tool-draw').click();
      } else if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
        this.shadow.getElementById('tool-fill').click();
      } else if (e.key === 'e' && !e.ctrlKey && !e.metaKey) {
        this.shadow.getElementById('tool-erase').click();
      }
    });
  }

  async _loadPrefs() {
    if (!chrome?.storage?.local) return;
    try {
      const prefs = await chrome.storage.local.get([
        'canvas_brush_color',
        'canvas_brush_size',
      ]);
      if (prefs.canvas_brush_color) {
        this.engine.setColor(prefs.canvas_brush_color);
        this.shadow.getElementById('color-picker').value = prefs.canvas_brush_color;
      }
      if (prefs.canvas_brush_size) {
        const size = Number(prefs.canvas_brush_size);
        this.engine.setBrushSize(size);
        this.shadow.getElementById('radius-slider').value = size;
        this.shadow.getElementById('radius-value').textContent = size;
        this._updateCursorPreviewSize(size);
      }
    } catch (e) {
      // Storage not available, use defaults
    }
  }

  _savePref(key, value) {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.set({ [key]: value }).catch(() => {});
  }
}

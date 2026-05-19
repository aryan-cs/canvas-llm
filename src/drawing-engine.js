/* ── Shared Drawing Engine ── */
const MAX_HISTORY = 30;

export class DrawingEngine {
  constructor(canvas, container, opts = {}) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });

    this.tool = 'draw';
    this.color = '#000000';
    this.brushSize = 3;
    this.background = opts.background || '#ffffff';
    this.onHistoryChange = opts.onHistoryChange || (() => {});

    this._isDrawing = false;
    this._lastPt = null;
    this._undoStack = [];
    this._undoIdx = -1;

    // Bind pointer handlers
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);

    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
  }

  /* ── Tool state ── */
  setTool(t) { this.tool = t; }
  setColor(c) { this.color = c; }
  setBrushSize(s) { this.brushSize = s; }

  /* ── Resize (retina-aware, preserves content) ── */
  resize() {
    const r = this.container.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const dpr = devicePixelRatio || 1;
    const { canvas, ctx } = this;

    const old = document.createElement('canvas');
    old.width = canvas.width; old.height = canvas.height;
    old.getContext('2d').drawImage(canvas, 0, 0);

    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, r.width, r.height);

    if (old.width > 0 && old.height > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(old, 0, 0);
      ctx.restore();
    }
  }

  /* ── Undo / Redo ── */
  pushUndo() {
    const { canvas, ctx } = this;
    if (canvas.width === 0 || canvas.height === 0) return;
    this._undoStack = this._undoStack.slice(0, this._undoIdx + 1);
    this._undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (this._undoStack.length > MAX_HISTORY) this._undoStack.shift();
    this._undoIdx = this._undoStack.length - 1;
    this.onHistoryChange();
  }

  _restoreUndo() {
    const s = this._undoStack[this._undoIdx];
    if (!s) return;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.putImageData(s, 0, 0);
    this.ctx.restore();
    this.onHistoryChange();
  }

  undo() { if (this._undoIdx > 0) { this._undoIdx--; this._restoreUndo(); } }
  redo() { if (this._undoIdx < this._undoStack.length - 1) { this._undoIdx++; this._restoreUndo(); } }
  canUndo() { return this._undoIdx > 0; }
  canRedo() { return this._undoIdx < this._undoStack.length - 1; }

  /* ── Clear ── */
  clear() {
    const dpr = devicePixelRatio || 1;
    const { ctx, container } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = container.getBoundingClientRect();
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, r.width, r.height);
    this.pushUndo();
  }

  /* ── Background switching ── */
  setBackground(bg, repaint) {
    const oldBg = this.background;
    this.background = bg;

    if (repaint && this.canvas.width > 0 && this.canvas.height > 0) {
      const { ctx, canvas } = this;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      const oldR = parseInt(oldBg.slice(1,3),16), oldG = parseInt(oldBg.slice(3,5),16), oldB = parseInt(oldBg.slice(5,7),16);
      const newR = parseInt(bg.slice(1,3),16), newG = parseInt(bg.slice(3,5),16), newB = parseInt(bg.slice(5,7),16);
      const tol = 10;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i]-oldR) <= tol && Math.abs(d[i+1]-oldG) <= tol && Math.abs(d[i+2]-oldB) <= tol && d[i+3] > 240) {
          d[i] = newR; d[i+1] = newG; d[i+2] = newB;
        }
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(imgData, 0, 0);
      ctx.restore();
      this.pushUndo();
    }
  }

  /* ── Export ── */
  toDataURL() { return this.canvas.toDataURL('image/png'); }
  toBlob() { return new Promise(resolve => this.canvas.toBlob(resolve, 'image/png')); }

  /* ── Pointer handlers ── */
  _pt(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = this._pt(e);
    this._isDrawing = true;
    this._lastPt = p;
    this.canvas.setPointerCapture(e.pointerId);

    const { ctx } = this;
    ctx.globalCompositeOperation = this.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
  }

  _onMove(e) {
    if (!this._isDrawing) return;
    e.preventDefault();
    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evts) {
      const p = this._pt(ev);
      this.ctx.beginPath();
      this.ctx.moveTo(this._lastPt.x, this._lastPt.y);
      this.ctx.lineTo(p.x, p.y);
      this.ctx.stroke();
      this._lastPt = p;
    }
  }

  _onUp(e) {
    if (!this._isDrawing) return;
    this._isDrawing = false;
    this._lastPt = null;
    this.canvas.releasePointerCapture(e.pointerId);
    this.ctx.globalCompositeOperation = 'source-over';
    this.pushUndo();
  }

  /* ── Cleanup ── */
  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onUp);
  }
}

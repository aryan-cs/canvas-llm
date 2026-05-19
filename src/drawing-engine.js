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
    this.gridOverlay = opts.gridOverlay || null;
    this._gridSize = 50;
    this._gridOn = false;
    this.onHistoryChange = opts.onHistoryChange || (() => {});
    this.onDrawEvent = opts.onDrawEvent || null;

    this._isDrawing = false;
    this._lastPt = null;
    this._activePointerId = null;
    this._pendingStrokeStart = null;
    this._strokeStartSent = false;
    this._undoStack = [];
    this._undoIdx = -1;
    this._remoteLast = null;

    // View transform (zoom/pan)
    this.paused = false;
    this._viewScale = 1;
    this._viewPanX = 0;
    this._viewPanY = 0;

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

  /* ── Grid ── */
  setGrid(on, size) {
    this._gridOn = on;
    if (size !== undefined) this._gridSize = size;
    if (!this.gridOverlay) return;
    if (!on) {
      this.gridOverlay.style.display = 'none';
      return;
    }
    this.gridOverlay.style.display = 'block';
    this._updateGridTransform();
  }

  setGridSize(size) {
    this._gridSize = size;
    if (this._gridOn) this._updateGridTransform();
  }

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
    const { ctx, canvas } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fill entire canvas (which may be expanded beyond container)
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, cssW, cssH);
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

  /* ── View transform (zoom / pan) ── */
  setViewTransform(scale, panX, panY) {
    scale = Math.max(0.25, Math.min(5, scale));
    this._viewScale = scale;
    this._viewPanX = panX;
    this._viewPanY = panY;

    // Zoom/pan is purely a CSS transform — never touch the backing store here.
    // Canvas expansion happens lazily in _onDown / remoteStroke when a stroke
    // would land outside current bounds.
    this.canvas.style.transformOrigin = '0 0';
    this.canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    this._updateGridTransform();
  }

  /* Grow the canvas backing store so a point (in canvas-local coords) is drawable.
     Called lazily from _onDown / remoteStroke — never during zoom/pan.
     Adds generous buffer so subsequent strokes rarely re-trigger. */
  _expandCanvasForPoint(px, py) {
    const dpr = devicePixelRatio || 1;
    const curW = this.canvas.width / dpr;
    const curH = this.canvas.height / dpr;

    // How much the point lies outside current bounds
    const expandLeft = Math.max(0, -px);
    const expandTop = Math.max(0, -py);
    const expandRight = Math.max(0, px - curW + 1);
    const expandBottom = Math.max(0, py - curH + 1);

    if (expandLeft < 1 && expandTop < 1 && expandRight < 1 && expandBottom < 1) return;

    // Add generous buffer (500px each direction that needs it) to avoid re-triggering
    const buf = 500;
    const totalLeft = Math.ceil(expandLeft + (expandLeft > 0 ? buf : 0));
    const totalTop = Math.ceil(expandTop + (expandTop > 0 ? buf : 0));
    const totalRight = Math.ceil(expandRight + (expandRight > 0 ? buf : 0));
    const totalBottom = Math.ceil(expandBottom + (expandBottom > 0 ? buf : 0));

    const newW = Math.ceil(curW + totalLeft + totalRight);
    const newH = Math.ceil(curH + totalTop + totalBottom);
    const offX = totalLeft;
    const offY = totalTop;

    // Save current content
    const old = document.createElement('canvas');
    old.width = this.canvas.width;
    old.height = this.canvas.height;
    old.getContext('2d').drawImage(this.canvas, 0, 0);

    // Resize canvas
    this.canvas.width = newW * dpr;
    this.canvas.height = newH * dpr;
    this.canvas.style.width = newW + 'px';
    this.canvas.style.height = newH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Fill with background
    this.ctx.fillStyle = this.background;
    this.ctx.fillRect(0, 0, newW, newH);

    // Restore content at offset
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(old, offX * dpr, offY * dpr);
    this.ctx.restore();

    // Clear undo stack — old snapshots have wrong origin.
    // Push one fresh snapshot so undo still works after expansion.
    this._undoStack = [];
    this._undoIdx = -1;
    this.pushUndo();

    // Shift the pan to compensate for the canvas origin moving
    if (offX > 0 || offY > 0) {
      this._viewPanX += offX * this._viewScale;
      this._viewPanY += offY * this._viewScale;
      // Update the CSS transform so coordinates stay correct
      this.canvas.style.transform = `translate(${this._viewPanX}px, ${this._viewPanY}px) scale(${this._viewScale})`;
    }
  }

  resetView() {
    this.setViewTransform(1, 0, 0);
  }

  _updateGridTransform() {
    if (!this.gridOverlay || this.gridOverlay.style.display === 'none') return;
    // Keep grid as infinite repeating pattern — adjust size and offset to match zoom/pan
    const size = this._gridSize * this._viewScale;
    const c = this.background === '#000000' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
    this.gridOverlay.style.backgroundImage =
      `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`;
    this.gridOverlay.style.backgroundSize = `${size}px ${size}px`;
    this.gridOverlay.style.backgroundPosition =
      `${this._viewPanX % size}px ${this._viewPanY % size}px`;
    // No CSS transform on grid — it stays full-size and infinite
    this.gridOverlay.style.transform = '';
  }

  cancelStroke() {
    if (!this._isDrawing) return;
    this._isDrawing = false;
    this._lastPt = null;
    this.ctx.globalCompositeOperation = 'source-over';
    // Release pointer capture so touch events work for gestures
    if (this._activePointerId != null) {
      try { this.canvas.releasePointerCapture(this._activePointerId); } catch {}
      this._activePointerId = null;
    }
    if (this._undoIdx >= 0) this._restoreUndo();
    // If stroke-start was never sent (still buffered), just discard it — remote
    // never saw it, so no cancel needed. Only send cancel if it was already flushed.
    if (this._pendingStrokeStart) {
      this._pendingStrokeStart = null;
    } else if (this._strokeStartSent && this.onDrawEvent) {
      this.onDrawEvent({ type: 'stroke-cancel' });
    }
    this._strokeStartSent = false;
  }

  /* ── Load an image onto the canvas ── */
  loadImage(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const { ctx, canvas } = this;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // Maintain aspect ratio: scale to fit canvas width
        const dpr = devicePixelRatio || 1;
        const cw = canvas.width;
        const scale = cw / img.width;
        const dh = img.height * scale;
        ctx.fillStyle = this.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, cw, dh);
        ctx.restore();
        this.pushUndo();
        resolve();
      };
      img.onerror = () => resolve();
      img.src = dataUrl;
    });
  }

  /* ── Export (captures current viewport when zoomed/panned) ── */
  toDataURL() {
    if (this._viewScale === 1 && this._viewPanX === 0 && this._viewPanY === 0) {
      return this.canvas.toDataURL('image/png');
    }
    return this._exportView().toDataURL('image/png');
  }

  toBlob() {
    if (this._viewScale === 1 && this._viewPanX === 0 && this._viewPanY === 0) {
      return new Promise(resolve => this.canvas.toBlob(resolve, 'image/png'));
    }
    return new Promise(resolve => this._exportView().toBlob(resolve, 'image/png'));
  }

  _exportView() {
    const dpr = devicePixelRatio || 1;
    const r = this.container.getBoundingClientRect();
    const tmp = document.createElement('canvas');
    tmp.width = r.width * dpr;
    tmp.height = r.height * dpr;
    const ctx = tmp.getContext('2d');
    ctx.scale(dpr, dpr);
    // Fill background
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, r.width, r.height);
    // Draw source canvas with current view transform
    ctx.translate(this._viewPanX, this._viewPanY);
    ctx.scale(this._viewScale, this._viewScale);
    // Use actual canvas CSS dimensions (may be larger than container after expansion)
    const cssW = this.canvas.width / dpr;
    const cssH = this.canvas.height / dpr;
    ctx.drawImage(this.canvas, 0, 0, cssW, cssH);
    return tmp;
  }

  /* ── Remote stroke replay ── */
  remoteStroke(event) {
    const r = this.container.getBoundingClientRect();
    const { ctx } = this;

    switch (event.type) {
      case 'stroke-start': {
        let x = event.nx * r.width;
        let y = event.ny * r.width;
        // Expand canvas if remote stroke lands outside current bounds
        this._expandCanvasForPoint(x, y);
        // Re-derive after expansion may have shifted origin
        x = event.nx * r.width;
        y = event.ny * r.width;
        const prevOp = ctx.globalCompositeOperation;
        const prevStroke = ctx.strokeStyle;
        const prevWidth = ctx.lineWidth;
        const prevCap = ctx.lineCap;
        const prevJoin = ctx.lineJoin;
        ctx.globalCompositeOperation = event.tool === 'erase' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = event.color;
        ctx.lineWidth = event.brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.1, y + 0.1);
        ctx.stroke();
        ctx.globalCompositeOperation = prevOp;
        ctx.strokeStyle = prevStroke;
        ctx.lineWidth = prevWidth;
        ctx.lineCap = prevCap;
        ctx.lineJoin = prevJoin;
        this._remoteLast = { x, y, tool: event.tool, color: event.color, brushSize: event.brushSize };
        break;
      }
      case 'stroke-move': {
        if (!this._remoteLast) break;
        const x = event.nx * r.width;
        const y = event.ny * r.width;
        const prevOp = ctx.globalCompositeOperation;
        const prevStroke = ctx.strokeStyle;
        const prevWidth = ctx.lineWidth;
        const prevCap = ctx.lineCap;
        const prevJoin = ctx.lineJoin;
        ctx.globalCompositeOperation = this._remoteLast.tool === 'erase' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = this._remoteLast.color;
        ctx.lineWidth = this._remoteLast.brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(this._remoteLast.x, this._remoteLast.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalCompositeOperation = prevOp;
        ctx.strokeStyle = prevStroke;
        ctx.lineWidth = prevWidth;
        ctx.lineCap = prevCap;
        ctx.lineJoin = prevJoin;
        this._remoteLast.x = x;
        this._remoteLast.y = y;
        break;
      }
      case 'stroke-end':
        this._remoteLast = null;
        this.pushUndo();
        break;
      case 'stroke-cancel':
        // Remote cancelled a partial stroke (e.g. pinch gesture interrupted it)
        this._remoteLast = null;
        if (this._undoIdx >= 0) this._restoreUndo();
        break;
      case 'clear':
        this.clear();
        break;
    }
  }

  /* ── Pointer handlers ── */
  _pt(e) {
    const r = this.container.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - this._viewPanX) / this._viewScale,
      y: (e.clientY - r.top - this._viewPanY) / this._viewScale,
    };
  }

  _onDown(e) {
    if (this.paused || e.button !== 0) return;
    // Only handle first pointer — prevent second finger from starting a new stroke
    if (this._isDrawing) return;
    e.preventDefault();

    // Lazily expand canvas if the stroke lands outside current bounds.
    // Must happen before _pt() so the pan compensation is already applied.
    let p = this._pt(e);
    this._expandCanvasForPoint(p.x, p.y);
    // Re-derive point after expansion may have shifted _viewPanX/_viewPanY
    p = this._pt(e);

    this._isDrawing = true;
    this._lastPt = p;
    this._activePointerId = e.pointerId;
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

    // Buffer stroke-start — only send to remote after first move confirms it's
    // a real stroke, not a gesture that will be cancelled immediately
    this._strokeStartSent = false;
    if (this.onDrawEvent) {
      const r = this.container.getBoundingClientRect();
      this._pendingStrokeStart = {
        type: 'stroke-start',
        nx: p.x / r.width,
        ny: p.y / r.width,
        tool: this.tool,
        color: this.color,
        brushSize: this.brushSize,
      };
    }
  }

  _onMove(e) {
    if (!this._isDrawing || this.paused) return;
    if (e.pointerId !== this._activePointerId) return;
    e.preventDefault();

    // Flush pending stroke-start on first move — confirms this is a real stroke
    if (this._pendingStrokeStart && this.onDrawEvent) {
      this.onDrawEvent(this._pendingStrokeStart);
      this._pendingStrokeStart = null;
      this._strokeStartSent = true;
    }

    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const r = this.onDrawEvent ? this.container.getBoundingClientRect() : null;
    for (const ev of evts) {
      const p = this._pt(ev);
      this.ctx.beginPath();
      this.ctx.moveTo(this._lastPt.x, this._lastPt.y);
      this.ctx.lineTo(p.x, p.y);
      this.ctx.stroke();
      this._lastPt = p;

      if (this.onDrawEvent && r) {
        this.onDrawEvent({
          type: 'stroke-move',
          nx: p.x / r.width,
          ny: p.y / r.width,
        });
      }
    }
  }

  _onUp(e) {
    if (!this._isDrawing) return;
    if (e.pointerId !== this._activePointerId) return;
    this._isDrawing = false;
    this._lastPt = null;
    this._activePointerId = null;
    this.canvas.releasePointerCapture(e.pointerId);
    this.ctx.globalCompositeOperation = 'source-over';
    this.pushUndo();

    if (this.onDrawEvent) {
      // Flush pending stroke-start for taps (pointerdown with no move)
      if (this._pendingStrokeStart) {
        this.onDrawEvent(this._pendingStrokeStart);
        this._pendingStrokeStart = null;
      }
      this.onDrawEvent({ type: 'stroke-end' });
    }
    this._strokeStartSent = false;
  }

  /* ── Cleanup ── */
  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onUp);
  }
}

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

    // Expand canvas to cover visible area when zoomed out
    this._expandCanvasForView();

    this.canvas.style.transformOrigin = '0 0';
    this.canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    this._updateGridTransform();
  }

  /* Grow the canvas backing store so the full visible area is drawable.
     Adds a buffer (50% of container) so we don't re-expand on every wheel tick. */
  _expandCanvasForView() {
    const r = this.container.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const dpr = devicePixelRatio || 1;

    // Visible area in canvas-local coordinates
    const visLeft = -this._viewPanX / this._viewScale;
    const visTop = -this._viewPanY / this._viewScale;
    const visRight = visLeft + r.width / this._viewScale;
    const visBottom = visTop + r.height / this._viewScale;

    // Current canvas bounds in CSS pixels
    const curW = this.canvas.width / dpr;
    const curH = this.canvas.height / dpr;

    // How much we need to expand in each direction
    const expandLeft = Math.max(0, -visLeft);
    const expandTop = Math.max(0, -visTop);
    const expandRight = Math.max(0, visRight - curW);
    const expandBottom = Math.max(0, visBottom - curH);

    if (expandLeft < 1 && expandTop < 1 && expandRight < 1 && expandBottom < 1) return;

    // Add 50% buffer so we don't re-expand on every gesture tick
    const bufW = r.width * 0.5 / this._viewScale;
    const bufH = r.height * 0.5 / this._viewScale;

    const totalLeft = Math.ceil(expandLeft + (expandLeft > 0 ? bufW : 0));
    const totalTop = Math.ceil(expandTop + (expandTop > 0 ? bufH : 0));
    const totalRight = Math.ceil(expandRight + (expandRight > 0 ? bufW : 0));
    const totalBottom = Math.ceil(expandBottom + (expandBottom > 0 ? bufH : 0));

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

    // Translate existing undo snapshots into new dimensions
    const newStack = [];
    for (const snap of this._undoStack) {
      const tmpC = document.createElement('canvas');
      tmpC.width = newW * dpr;
      tmpC.height = newH * dpr;
      const tmpCtx = tmpC.getContext('2d');
      // Fill background in new dimensions
      tmpCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tmpCtx.fillStyle = this.background;
      tmpCtx.fillRect(0, 0, newW, newH);
      // Paste old snapshot at offset
      tmpCtx.setTransform(1, 0, 0, 1, 0, 0);
      tmpCtx.putImageData(snap, offX * dpr, offY * dpr);
      newStack.push(tmpCtx.getImageData(0, 0, newW * dpr, newH * dpr));
    }
    this._undoStack = newStack;
    // Push current state as latest undo entry (replacing the old top if it matches)
    if (this._undoIdx >= this._undoStack.length) this._undoIdx = this._undoStack.length - 1;
    // Add new snapshot of the current expanded canvas
    this._undoStack = this._undoStack.slice(0, this._undoIdx + 1);
    this._undoStack.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    if (this._undoStack.length > MAX_HISTORY) this._undoStack.shift();
    this._undoIdx = this._undoStack.length - 1;

    // Shift the pan to compensate for the canvas origin moving
    if (offX > 0 || offY > 0) {
      this._viewPanX += offX * this._viewScale;
      this._viewPanY += offY * this._viewScale;
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
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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
        const x = event.nx * r.width;
        const y = event.ny * r.height;
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
        const y = event.ny * r.height;
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
    const p = this._pt(e);
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
        ny: p.y / r.height,
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
          ny: p.y / r.height,
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

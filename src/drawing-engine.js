/* ── Shared Drawing Engine (vector-based, infinite whiteboard model) ──

   Architecture (same as Excalidraw / tldraw / Miro / FigJam):
   - World coordinate space: infinite 2D plane, shared by all devices.
   - Strokes stored as vectors: [{ tool, color, brushSize, points: [{x,y}, ...] }].
   - Each device has its OWN viewport (panX, panY, scale) — never synced.
   - Canvas is a window into the world; we redraw all strokes through the
     viewport transform on every frame.
   - Network sync sends world coordinates only; receivers convert to their
     own screen via their local viewport. */

const MAX_HISTORY = 50;

export class DrawingEngine {
  constructor(canvas, container, opts = {}) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d');

    this.tool = 'draw';
    this.color = '#000000';
    this.brushSize = 3;
    this.background = opts.background || '#ffffff';
    this.gridOverlay = opts.gridOverlay || null;
    this._gridSize = 50;
    this._gridOn = false;
    this.onHistoryChange = opts.onHistoryChange || (() => {});
    this.onDrawEvent = opts.onDrawEvent || null;

    // Vector storage
    this._strokes = [];            // Committed strokes (world coords)
    this._currentLocalStroke = null;
    this._currentRemoteStroke = null;
    this._undoStack = [];          // Snapshots of _strokes (JSON strings)
    this._undoIdx = -1;

    // Viewport — LOCAL to this device, never synced
    this._viewScale = 1;
    this._viewPanX = 0;
    this._viewPanY = 0;
    this.paused = false;

    // Pointer state
    this._isDrawing = false;
    this._activePointerId = null;
    this._strokeStartSent = false;
    this._pendingStrokeStart = null;

    // Bind handlers
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);

    container.addEventListener('pointerdown', this._onDown);
    container.addEventListener('pointermove', this._onMove);
    container.addEventListener('pointerup', this._onUp);
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

  _updateGridTransform() {
    if (!this.gridOverlay || this.gridOverlay.style.display === 'none') return;
    const size = this._gridSize * this._viewScale;
    const c = this.background === '#000000' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
    this.gridOverlay.style.backgroundImage =
      `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`;
    this.gridOverlay.style.backgroundSize = `${size}px ${size}px`;
    this.gridOverlay.style.backgroundPosition = `${this._viewPanX % size}px ${this._viewPanY % size}px`;
    this.gridOverlay.style.transform = '';
  }

  /* ── Resize canvas to match container, redraw all strokes ── */
  resize() {
    const r = this.container.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const dpr = devicePixelRatio || 1;
    const { canvas } = this;

    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    canvas.style.transform = '';

    this._redraw();
  }

  /* ── Apply the combined dpr × viewport transform to the ctx ── */
  _applyTransform() {
    const dpr = devicePixelRatio || 1;
    const s = dpr * this._viewScale;
    this.ctx.setTransform(s, 0, 0, s, dpr * this._viewPanX, dpr * this._viewPanY);
  }

  /* ── Full redraw — clear, fill background, draw every stroke ── */
  _redraw() {
    const { ctx, canvas } = this;
    // Background — in raw pixels, no transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply viewport transform for stroke rendering
    this._applyTransform();

    for (const stroke of this._strokes) {
      this._renderStroke(stroke);
    }
    if (this._currentLocalStroke) this._renderStroke(this._currentLocalStroke);
    if (this._currentRemoteStroke) this._renderStroke(this._currentRemoteStroke);
  }

  /* Render a single stroke (ctx transform is already set to viewport+dpr) */
  _renderStroke(stroke) {
    const { ctx } = this;
    const pts = stroke.points;
    if (!pts || pts.length === 0) return;

    ctx.globalCompositeOperation = stroke.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) {
      ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
    } else {
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* Incremental draw of one segment (avoids redrawing all strokes per move) */
  _drawSegment(stroke, p1, p2) {
    const { ctx } = this;
    this._applyTransform();
    ctx.globalCompositeOperation = stroke.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    if (p1.x === p2.x && p1.y === p2.y) {
      ctx.lineTo(p2.x + 0.1, p2.y + 0.1);
    } else {
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ── Screen → world transform ── */
  _screenToWorld(e) {
    const r = this.container.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return {
      x: (sx - this._viewPanX) / this._viewScale,
      y: (sy - this._viewPanY) / this._viewScale,
    };
  }

  /* ── Undo / Redo (vector-based, snapshot the stroke list) ── */
  pushUndo() {
    this._undoStack = this._undoStack.slice(0, this._undoIdx + 1);
    this._undoStack.push(JSON.stringify(this._strokes));
    if (this._undoStack.length > MAX_HISTORY) this._undoStack.shift();
    this._undoIdx = this._undoStack.length - 1;
    this.onHistoryChange();
  }

  undo() {
    if (this._undoIdx > 0) {
      this._undoIdx--;
      this._strokes = JSON.parse(this._undoStack[this._undoIdx]);
      this._redraw();
      this.onHistoryChange();
    }
  }

  redo() {
    if (this._undoIdx < this._undoStack.length - 1) {
      this._undoIdx++;
      this._strokes = JSON.parse(this._undoStack[this._undoIdx]);
      this._redraw();
      this.onHistoryChange();
    }
  }

  canUndo() { return this._undoIdx > 0; }
  canRedo() { return this._undoIdx < this._undoStack.length - 1; }

  /* ── Clear ── */
  clear() {
    this._strokes = [];
    this._currentLocalStroke = null;
    this._currentRemoteStroke = null;
    this.pushUndo();
    this._redraw();
  }

  /* ── Background ── */
  setBackground(bg /*, repaint */) {
    this.background = bg;
    this._redraw();
    this._updateGridTransform();
  }

  /* ── Viewport (zoom / pan) — purely local, never synced ── */
  setViewTransform(scale, panX, panY) {
    scale = Math.max(0.1, Math.min(10, scale));
    this._viewScale = scale;
    this._viewPanX = panX;
    this._viewPanY = panY;
    this._redraw();
    this._updateGridTransform();
  }

  resetView() {
    this.setViewTransform(1, 0, 0);
  }

  /* World-coordinate viewport sync — aspect-ratio-aware.
     Returns the world-space point at the center of this device's viewport. */
  getViewCenter() {
    const r = this.container.getBoundingClientRect();
    return {
      x: (r.width / 2 - this._viewPanX) / this._viewScale,
      y: (r.height / 2 - this._viewPanY) / this._viewScale,
      scale: this._viewScale,
    };
  }

  /* Pan so the given world point sits at this device's screen center,
     at the given scale. Aspect ratios don't matter — the center aligns. */
  setViewCenter(worldX, worldY, scale) {
    const r = this.container.getBoundingClientRect();
    scale = Math.max(0.1, Math.min(10, scale));
    const panX = r.width / 2 - worldX * scale;
    const panY = r.height / 2 - worldY * scale;
    this.setViewTransform(scale, panX, panY);
  }

  /* ── Pointer handlers ── */
  _onDown(e) {
    if (this.paused || e.button !== 0) return;
    if (this._isDrawing) return;
    // Don't intercept clicks on overlay UI (paste/send buttons, status toasts, etc.)
    if (e.target !== this.canvas && e.target !== this.container) return;
    e.preventDefault();

    const p = this._screenToWorld(e);
    this._isDrawing = true;
    this._activePointerId = e.pointerId;
    this.container.setPointerCapture(e.pointerId);

    this._currentLocalStroke = {
      tool: this.tool,
      color: this.color,
      brushSize: this.brushSize,
      points: [p],
    };

    // Draw the initial dot
    this._drawSegment(this._currentLocalStroke, p, p);

    // Buffer stroke-start — flushed on first move so gestures can cancel it
    this._strokeStartSent = false;
    if (this.onDrawEvent) {
      this._pendingStrokeStart = {
        type: 'stroke-start',
        x: p.x, y: p.y,
        tool: this.tool, color: this.color, brushSize: this.brushSize,
      };
    }
  }

  _onMove(e) {
    if (!this._isDrawing || this.paused) return;
    if (e.pointerId !== this._activePointerId) return;
    e.preventDefault();

    // Flush stroke-start on first move — confirms it's a real stroke
    if (this._pendingStrokeStart && this.onDrawEvent) {
      this.onDrawEvent(this._pendingStrokeStart);
      this._pendingStrokeStart = null;
      this._strokeStartSent = true;
    }

    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const stroke = this._currentLocalStroke;
    for (const ev of evts) {
      const p = this._screenToWorld(ev);
      const last = stroke.points[stroke.points.length - 1];
      stroke.points.push(p);
      this._drawSegment(stroke, last, p);
      if (this.onDrawEvent) {
        this.onDrawEvent({ type: 'stroke-move', x: p.x, y: p.y });
      }
    }
  }

  _onUp(e) {
    if (!this._isDrawing) return;
    if (e.pointerId !== this._activePointerId) return;
    this._isDrawing = false;
    this._activePointerId = null;
    try { this.container.releasePointerCapture(e.pointerId); } catch {}

    if (this._currentLocalStroke) {
      this._strokes.push(this._currentLocalStroke);
      this._currentLocalStroke = null;
    }
    this.pushUndo();

    if (this.onDrawEvent) {
      // Flush pending stroke-start for taps (down + up with no move)
      if (this._pendingStrokeStart) {
        this.onDrawEvent(this._pendingStrokeStart);
        this._pendingStrokeStart = null;
      }
      this.onDrawEvent({ type: 'stroke-end' });
    }
    this._strokeStartSent = false;
  }

  cancelStroke() {
    if (!this._isDrawing) return;
    this._isDrawing = false;
    if (this._activePointerId != null) {
      try { this.container.releasePointerCapture(this._activePointerId); } catch {}
      this._activePointerId = null;
    }
    this._currentLocalStroke = null;
    this._redraw();

    if (this._pendingStrokeStart) {
      this._pendingStrokeStart = null;
    } else if (this._strokeStartSent && this.onDrawEvent) {
      this.onDrawEvent({ type: 'stroke-cancel' });
    }
    this._strokeStartSent = false;
  }

  /* ── Remote stroke replay ── */
  remoteStroke(event) {
    switch (event.type) {
      case 'stroke-start': {
        this._currentRemoteStroke = {
          tool: event.tool,
          color: event.color,
          brushSize: event.brushSize,
          points: [{ x: event.x, y: event.y }],
        };
        this._drawSegment(this._currentRemoteStroke,
          { x: event.x, y: event.y }, { x: event.x, y: event.y });
        break;
      }
      case 'stroke-move': {
        if (!this._currentRemoteStroke) break;
        const stroke = this._currentRemoteStroke;
        const last = stroke.points[stroke.points.length - 1];
        const p = { x: event.x, y: event.y };
        stroke.points.push(p);
        this._drawSegment(stroke, last, p);
        break;
      }
      case 'stroke-end': {
        if (this._currentRemoteStroke) {
          this._strokes.push(this._currentRemoteStroke);
          this._currentRemoteStroke = null;
          this.pushUndo();
        }
        break;
      }
      case 'stroke-cancel': {
        this._currentRemoteStroke = null;
        this._redraw();
        break;
      }
      case 'clear': {
        this.clear();
        break;
      }
    }
  }

  /* ── Stroke list import/export (for peer sync) ── */
  serializeStrokes() {
    return JSON.parse(JSON.stringify(this._strokes));
  }

  loadStrokes(strokes) {
    this._strokes = Array.isArray(strokes) ? strokes : [];
    this._currentLocalStroke = null;
    this._currentRemoteStroke = null;
    this.pushUndo();
    this._redraw();
  }

  /* ── Export (current viewport as PNG, for chat paste) ── */
  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }

  toBlob() {
    return new Promise(resolve => this.canvas.toBlob(resolve, 'image/png'));
  }

  /* ── Cleanup ── */
  destroy() {
    this.container.removeEventListener('pointerdown', this._onDown);
    this.container.removeEventListener('pointermove', this._onMove);
    this.container.removeEventListener('pointerup', this._onUp);
  }
}

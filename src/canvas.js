const MAX_HISTORY = 30;

export class DrawingEngine {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });

    this.tool = 'draw';
    this.color = '#000000';
    this.brushSize = 3;
    this.isDrawing = false;
    this.lastPoint = null;

    this.history = [];
    this.historyIndex = -1;

    this.onHistoryChange = null;

    this._resize();
    this._fillWhite();
    this._pushHistory();

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);

    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointerleave', this._onPointerLeave);

    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(container);
  }

  setTool(tool) {
    this.tool = tool;
  }

  setColor(color) {
    this.color = color;
  }

  setBrushSize(size) {
    this.brushSize = size;
  }

  clear() {
    this._fillWhite();
    this._pushHistory();
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this._restoreHistory();
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this._restoreHistory();
  }

  canUndo() {
    return this.historyIndex > 0;
  }

  canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  toBlob() {
    return new Promise((resolve) => {
      this.canvas.toBlob(resolve, 'image/png');
    });
  }

  isEmpty() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const data = this.ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < 200; i++) {
      const idx = (Math.floor(Math.random() * h) * w + Math.floor(Math.random() * w)) * 4;
      if (data[idx] !== 255 || data[idx + 1] !== 255 || data[idx + 2] !== 255) {
        return false;
      }
    }
    return true;
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
    this._resizeObserver.disconnect();
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.scale(dpr, dpr);
  }

  _handleResize() {
    const oldCanvas = document.createElement('canvas');
    oldCanvas.width = this.canvas.width;
    oldCanvas.height = this.canvas.height;
    oldCanvas.getContext('2d').drawImage(this.canvas, 0, 0);

    this._resize();
    this._fillWhite();

    const dpr = window.devicePixelRatio || 1;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(oldCanvas, 0, 0);
    this.ctx.restore();
  }

  _fillWhite() {
    const rect = this.container.getBoundingClientRect();
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
    this.ctx.restore();
  }

  _pushHistory() {
    this.history = this.history.slice(0, this.historyIndex + 1);
    const snapshot = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this.history.push(snapshot);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
    if (this.onHistoryChange) this.onHistoryChange();
  }

  _restoreHistory() {
    const snapshot = this.history[this.historyIndex];
    if (!snapshot) return;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.putImageData(snapshot, 0, 0);
    this.ctx.restore();
    if (this.onHistoryChange) this.onHistoryChange();
  }

  _getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    const point = this._getCanvasPoint(e);

    if (this.tool === 'fill') {
      this._floodFill(point.x, point.y);
      this._pushHistory();
      return;
    }

    this.isDrawing = true;
    this.lastPoint = point;
    this.canvas.setPointerCapture(e.pointerId);

    this.ctx.beginPath();
    this.ctx.moveTo(point.x, point.y);

    if (this.tool === 'erase') {
      this.ctx.globalCompositeOperation = 'destination-out';
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.strokeStyle = this.color;
    }
    this.ctx.lineWidth = this.brushSize;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    this.ctx.lineTo(point.x + 0.1, point.y + 0.1);
    this.ctx.stroke();
  }

  _onPointerMove(e) {
    if (!this.isDrawing) return;

    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const evt of events) {
      const point = this._getCanvasPoint(evt);
      this.ctx.beginPath();
      this.ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
      this.ctx.lineTo(point.x, point.y);
      this.ctx.stroke();
      this.lastPoint = point;
    }
  }

  _onPointerUp(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.lastPoint = null;
    this.canvas.releasePointerCapture(e.pointerId);

    if (this.tool === 'erase') {
      this.ctx.globalCompositeOperation = 'source-over';
    }
    this._pushHistory();
  }

  _onPointerLeave(e) {
    // Only end drawing if pointer was not captured
    if (!this.isDrawing) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) return;
    this._onPointerUp(e);
  }

  _floodFill(x, y) {
    const dpr = window.devicePixelRatio || 1;
    const px = Math.floor(x * dpr);
    const py = Math.floor(y * dpr);
    const w = this.canvas.width;
    const h = this.canvas.height;

    const imageData = this.ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    const targetIdx = (py * w + px) * 4;
    const targetR = data[targetIdx];
    const targetG = data[targetIdx + 1];
    const targetB = data[targetIdx + 2];
    const targetA = data[targetIdx + 3];

    const fillColor = this._hexToRgb(this.color);
    if (
      Math.abs(targetR - fillColor.r) < 3 &&
      Math.abs(targetG - fillColor.g) < 3 &&
      Math.abs(targetB - fillColor.b) < 3 &&
      targetA > 250
    ) {
      return;
    }

    const tolerance = 30;
    const visited = new Uint8Array(w * h);

    function matches(idx) {
      const i = idx * 4;
      return (
        Math.abs(data[i] - targetR) <= tolerance &&
        Math.abs(data[i + 1] - targetG) <= tolerance &&
        Math.abs(data[i + 2] - targetB) <= tolerance &&
        Math.abs(data[i + 3] - targetA) <= tolerance
      );
    }

    function setPixel(idx) {
      const i = idx * 4;
      data[i] = fillColor.r;
      data[i + 1] = fillColor.g;
      data[i + 2] = fillColor.b;
      data[i + 3] = 255;
    }

    const stack = [px + py * w];
    visited[px + py * w] = 1;

    while (stack.length > 0) {
      const idx = stack.pop();
      const ix = idx % w;
      const iy = (idx - ix) / w;

      // Scanline fill: find left and right boundaries
      let left = ix;
      while (left > 0 && matches((iy * w) + left - 1) && !visited[iy * w + left - 1]) {
        left--;
      }
      let right = ix;
      while (right < w - 1 && matches((iy * w) + right + 1) && !visited[iy * w + right + 1]) {
        right++;
      }

      for (let cx = left; cx <= right; cx++) {
        const ci = iy * w + cx;
        setPixel(ci);
        visited[ci] = 1;

        if (iy > 0) {
          const above = (iy - 1) * w + cx;
          if (!visited[above] && matches(above)) {
            visited[above] = 1;
            stack.push(above);
          }
        }
        if (iy < h - 1) {
          const below = (iy + 1) * w + cx;
          if (!visited[below] && matches(below)) {
            visited[below] = 1;
            stack.push(below);
          }
        }
      }
    }

    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.putImageData(imageData, 0, 0);
    this.ctx.restore();
  }

  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    } : { r: 0, g: 0, b: 0 };
  }
}

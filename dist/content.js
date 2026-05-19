(() => {
  // src/canvas.js
  var MAX_HISTORY = 30;
  var DrawingEngine = class {
    constructor(canvas, container) {
      this.canvas = canvas;
      this.container = container;
      this.ctx = canvas.getContext("2d", { willReadFrequently: true });
      this.tool = "draw";
      this.color = "#000000";
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
      canvas.addEventListener("pointerdown", this._onPointerDown);
      canvas.addEventListener("pointermove", this._onPointerMove);
      canvas.addEventListener("pointerup", this._onPointerUp);
      canvas.addEventListener("pointerleave", this._onPointerLeave);
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
        this.canvas.toBlob(resolve, "image/png");
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
      this.canvas.removeEventListener("pointerdown", this._onPointerDown);
      this.canvas.removeEventListener("pointermove", this._onPointerMove);
      this.canvas.removeEventListener("pointerup", this._onPointerUp);
      this.canvas.removeEventListener("pointerleave", this._onPointerLeave);
      this._resizeObserver.disconnect();
    }
    _resize() {
      const rect = this.container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.canvas.style.width = rect.width + "px";
      this.canvas.style.height = rect.height + "px";
      this.ctx.scale(dpr, dpr);
    }
    _handleResize() {
      const oldCanvas = document.createElement("canvas");
      oldCanvas.width = this.canvas.width;
      oldCanvas.height = this.canvas.height;
      oldCanvas.getContext("2d").drawImage(this.canvas, 0, 0);
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
      this.ctx.globalCompositeOperation = "source-over";
      this.ctx.fillStyle = "#ffffff";
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
        y: e.clientY - rect.top
      };
    }
    _onPointerDown(e) {
      if (e.button !== 0) return;
      const point = this._getCanvasPoint(e);
      if (this.tool === "fill") {
        this._floodFill(point.x, point.y);
        this._pushHistory();
        return;
      }
      this.isDrawing = true;
      this.lastPoint = point;
      this.canvas.setPointerCapture(e.pointerId);
      this.ctx.beginPath();
      this.ctx.moveTo(point.x, point.y);
      if (this.tool === "erase") {
        this.ctx.globalCompositeOperation = "destination-out";
      } else {
        this.ctx.globalCompositeOperation = "source-over";
        this.ctx.strokeStyle = this.color;
      }
      this.ctx.lineWidth = this.brushSize;
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
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
      if (this.tool === "erase") {
        this.ctx.globalCompositeOperation = "source-over";
      }
      this._pushHistory();
    }
    _onPointerLeave(e) {
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
      if (Math.abs(targetR - fillColor.r) < 3 && Math.abs(targetG - fillColor.g) < 3 && Math.abs(targetB - fillColor.b) < 3 && targetA > 250) {
        return;
      }
      const tolerance = 30;
      const visited = new Uint8Array(w * h);
      function matches(idx) {
        const i = idx * 4;
        return Math.abs(data[i] - targetR) <= tolerance && Math.abs(data[i + 1] - targetG) <= tolerance && Math.abs(data[i + 2] - targetB) <= tolerance && Math.abs(data[i + 3] - targetA) <= tolerance;
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
        let left = ix;
        while (left > 0 && matches(iy * w + left - 1) && !visited[iy * w + left - 1]) {
          left--;
        }
        let right = ix;
        while (right < w - 1 && matches(iy * w + right + 1) && !visited[iy * w + right + 1]) {
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
        b: parseInt(result[3], 16)
      } : { r: 0, g: 0, b: 0 };
    }
  };

  // src/adapters/base.js
  function queryWithFallbacks(selectors) {
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch (e) {
      }
    }
    return null;
  }
  function createFileFromBlob(blob, filename = "canvas-drawing.png") {
    return new File([blob], filename, { type: "image/png" });
  }
  function setFilesOnInput(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function dispatchPasteEvent(target, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt
    });
    target.dispatchEvent(event);
  }
  function dispatchDropEvent(target, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  }
  function waitForEnabled(element, timeoutMs = 15e3) {
    return new Promise((resolve, reject) => {
      if (!element) return reject(new Error("Element not found"));
      if (!element.disabled) return resolve(element);
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error("Timed out waiting for send button to become enabled"));
      }, timeoutMs);
      const observer = new MutationObserver(() => {
        if (!element.disabled) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(element);
        }
      });
      observer.observe(element, { attributes: true, attributeFilter: ["disabled"] });
    });
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // src/adapters/claude.js
  var INPUT_SELECTORS = [
    '[data-testid="chat-input"]',
    ".tiptap.ProseMirror",
    'div.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"]'
  ];
  var FILE_INPUT_SELECTORS = [
    'input[type="file"][data-testid]',
    'input[type="file"]'
  ];
  var SEND_SELECTORS = [
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    '[data-testid="send-button"]',
    'button[aria-label*="Send"]'
  ];
  var ClaudeAdapter = class {
    findInput() {
      return queryWithFallbacks(INPUT_SELECTORS);
    }
    async attachImage(blob) {
      const file = createFileFromBlob(blob);
      const fileInput = queryWithFallbacks(FILE_INPUT_SELECTORS);
      if (fileInput) {
        setFilesOnInput(fileInput, file);
        return;
      }
      const editor = this.findInput();
      if (!editor) throw new Error("Could not find Claude chat input");
      dispatchPasteEvent(editor, file);
    }
    async waitForImageReady() {
      await sleep(1e3);
      const sendBtn = queryWithFallbacks(SEND_SELECTORS);
      if (sendBtn && sendBtn.disabled) {
        await waitForEnabled(sendBtn, 15e3);
      }
    }
    async insertText(text) {
      const editor = this.findInput();
      if (!editor) throw new Error("Could not find Claude chat input");
      editor.focus();
      await sleep(100);
      document.execCommand("insertText", false, text);
    }
    async submit() {
      await sleep(300);
      const sendBtn = queryWithFallbacks(SEND_SELECTORS);
      if (!sendBtn) throw new Error("Could not find Claude send button");
      if (sendBtn.disabled) {
        await waitForEnabled(sendBtn, 1e4);
      }
      sendBtn.click();
    }
  };

  // src/adapters/chatgpt.js
  var INPUT_SELECTORS2 = [
    "#prompt-textarea",
    'div.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]'
  ];
  var FILE_INPUT_SELECTORS2 = [
    "#upload-files",
    "#upload-photos",
    'input[type="file"][multiple]',
    'input[type="file"]'
  ];
  var SEND_SELECTORS2 = [
    '[data-testid="send-button"]',
    "#composer-submit-button",
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send"]'
  ];
  var ChatGPTAdapter = class {
    findInput() {
      return queryWithFallbacks(INPUT_SELECTORS2);
    }
    async attachImage(blob) {
      const file = createFileFromBlob(blob);
      const fileInput = queryWithFallbacks(FILE_INPUT_SELECTORS2);
      if (fileInput) {
        setFilesOnInput(fileInput, file);
        return;
      }
      const editor = this.findInput();
      if (!editor) throw new Error("Could not find ChatGPT chat input");
      dispatchPasteEvent(editor, file);
    }
    async waitForImageReady() {
      await sleep(1500);
      const sendBtn = queryWithFallbacks(SEND_SELECTORS2);
      if (sendBtn && sendBtn.disabled) {
        await waitForEnabled(sendBtn, 15e3);
      }
    }
    async insertText(text) {
      const editor = this.findInput();
      if (!editor) throw new Error("Could not find ChatGPT chat input");
      editor.focus();
      await sleep(100);
      document.execCommand("insertText", false, text);
    }
    async submit() {
      await sleep(300);
      const sendBtn = queryWithFallbacks(SEND_SELECTORS2);
      if (!sendBtn) throw new Error("Could not find ChatGPT send button");
      if (sendBtn.disabled) {
        await waitForEnabled(sendBtn, 1e4);
      }
      sendBtn.click();
    }
  };

  // src/adapters/gemini.js
  var INPUT_SELECTORS3 = [
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][aria-label*="prompt"]',
    'div[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]'
  ];
  var DROP_TARGET_SELECTORS = [
    ".xap-uploader-dropzone",
    ".input-area-container",
    ".chat-input-container"
  ];
  var SEND_SELECTORS3 = [
    ".send-button",
    'button[aria-label="Send message"]',
    'button[aria-label*="Send"]',
    "button.send-button"
  ];
  var GeminiAdapter = class {
    findInput() {
      return queryWithFallbacks(INPUT_SELECTORS3);
    }
    async attachImage(blob) {
      const file = createFileFromBlob(blob);
      const dropTarget = queryWithFallbacks(DROP_TARGET_SELECTORS);
      if (dropTarget) {
        dispatchDropEvent(dropTarget, file);
        return;
      }
      const editor = this.findInput();
      if (!editor) throw new Error("Could not find Gemini chat input");
      dispatchPasteEvent(editor, file);
    }
    async waitForImageReady() {
      await sleep(2e3);
      const sendBtn = queryWithFallbacks(SEND_SELECTORS3);
      if (sendBtn && sendBtn.disabled) {
        await waitForEnabled(sendBtn, 15e3);
      }
    }
    async insertText(text) {
      const editor = this.findInput();
      if (!editor) throw new Error("Could not find Gemini chat input");
      editor.focus();
      await sleep(100);
      document.execCommand("insertText", false, text);
    }
    async submit() {
      await sleep(500);
      const sendBtn = queryWithFallbacks(SEND_SELECTORS3);
      if (!sendBtn) throw new Error("Could not find Gemini send button");
      if (sendBtn.disabled) {
        await waitForEnabled(sendBtn, 1e4);
      }
      sendBtn.click();
    }
  };

  // src/adapters/index.js
  function getAdapter() {
    const host2 = window.location.hostname;
    if (host2 === "claude.ai") return new ClaudeAdapter();
    if (host2 === "chatgpt.com" || host2 === "chat.openai.com") return new ChatGPTAdapter();
    if (host2 === "gemini.google.com") return new GeminiAdapter();
    throw new Error(`Unsupported site: ${host2}`);
  }

  // src/panel.js
  var PanelController = class {
    constructor(shadowRoot2, onPositionChange) {
      this.shadow = shadowRoot2;
      this.onPositionChange = onPositionChange;
      this.engine = null;
      this.cursorPreview = null;
      this._init();
    }
    _init() {
      const canvas = this.shadow.getElementById("drawing-canvas");
      const container = this.shadow.getElementById("canvas-container");
      this.cursorPreview = this.shadow.getElementById("cursor-preview");
      this.engine = new DrawingEngine(canvas, container);
      this.engine.onHistoryChange = () => this._updateUndoRedo();
      this._bindTools();
      this._bindCursorPreview(container);
      this._bindAttach();
      this._bindKeyboard();
      this._loadPrefs();
    }
    _bindTools() {
      const drawBtn = this.shadow.getElementById("tool-draw");
      const fillBtn = this.shadow.getElementById("tool-fill");
      const eraseBtn = this.shadow.getElementById("tool-erase");
      const undoBtn = this.shadow.getElementById("tool-undo");
      const redoBtn = this.shadow.getElementById("tool-redo");
      const colorPicker = this.shadow.getElementById("color-picker");
      const radiusSlider = this.shadow.getElementById("radius-slider");
      const radiusValue = this.shadow.getElementById("radius-value");
      const clearBtn = this.shadow.getElementById("tool-clear");
      const posBtn = this.shadow.getElementById("tool-position");
      this.undoBtn = undoBtn;
      this.redoBtn = redoBtn;
      const toolBtns = [drawBtn, fillBtn, eraseBtn];
      const setActiveTool = (btn, tool) => {
        toolBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.engine.setTool(tool);
        this._updateCursorStyle(tool);
      };
      drawBtn.addEventListener("click", () => setActiveTool(drawBtn, "draw"));
      fillBtn.addEventListener("click", () => setActiveTool(fillBtn, "fill"));
      eraseBtn.addEventListener("click", () => setActiveTool(eraseBtn, "erase"));
      undoBtn.addEventListener("click", () => this.engine.undo());
      redoBtn.addEventListener("click", () => this.engine.redo());
      colorPicker.addEventListener("input", (e) => {
        this.engine.setColor(e.target.value);
        this._savePref("canvas_brush_color", e.target.value);
      });
      radiusSlider.addEventListener("input", (e) => {
        const size = Number(e.target.value);
        this.engine.setBrushSize(size);
        radiusValue.textContent = size;
        this._updateCursorPreviewSize(size);
        this._savePref("canvas_brush_size", size);
      });
      clearBtn.addEventListener("click", () => this.engine.clear());
      posBtn.addEventListener("click", () => {
        if (this.onPositionChange) this.onPositionChange();
      });
    }
    _bindCursorPreview(container) {
      container.addEventListener("pointermove", (e) => {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.cursorPreview.style.left = x + "px";
        this.cursorPreview.style.top = y + "px";
        this.cursorPreview.style.display = "block";
      });
      container.addEventListener("pointerleave", () => {
        this.cursorPreview.style.display = "none";
      });
      this._updateCursorPreviewSize(this.engine.brushSize);
    }
    _updateCursorPreviewSize(size) {
      if (!this.cursorPreview) return;
      this.cursorPreview.style.width = size + "px";
      this.cursorPreview.style.height = size + "px";
    }
    _updateCursorStyle(tool) {
      const container = this.shadow.getElementById("canvas-container");
      if (tool === "fill") {
        container.style.cursor = "crosshair";
        this.cursorPreview.style.display = "none";
      } else {
        container.style.cursor = "none";
      }
    }
    _updateUndoRedo() {
      this.undoBtn.disabled = !this.engine.canUndo();
      this.redoBtn.disabled = !this.engine.canRedo();
    }
    // Attach-only: paste the canvas image into the site's chat input.
    // The user then types their own text and hits the site's own Send button.
    _bindAttach() {
      const attachBtn = this.shadow.getElementById("attach-btn");
      attachBtn.addEventListener("click", async () => {
        attachBtn.disabled = true;
        this._setStatus("Attaching...", "");
        try {
          const adapter = getAdapter();
          const blob = await this.engine.toBlob();
          await adapter.attachImage(blob);
          this._setStatus("Pasted to chat!", "success");
        } catch (err) {
          console.error("[Canvas]", err);
          this._setStatus(err.message || "Failed to paste", "error");
        } finally {
          attachBtn.disabled = false;
        }
      });
    }
    _setStatus(text, className) {
      const statusMsg = this.shadow.getElementById("status-message");
      statusMsg.textContent = text;
      statusMsg.className = className || "";
      if (className === "success") {
        setTimeout(() => {
          if (statusMsg.textContent === text) {
            statusMsg.textContent = "";
            statusMsg.className = "";
          }
        }, 3e3);
      }
    }
    _bindKeyboard() {
      this.shadow.host.addEventListener("keydown", (e) => {
        if (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
          e.preventDefault();
          this.engine.redo();
        } else if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.engine.undo();
        } else if (e.key === "d" && !e.ctrlKey && !e.metaKey) {
          this.shadow.getElementById("tool-draw").click();
        } else if (e.key === "f" && !e.ctrlKey && !e.metaKey) {
          this.shadow.getElementById("tool-fill").click();
        } else if (e.key === "e" && !e.ctrlKey && !e.metaKey) {
          this.shadow.getElementById("tool-erase").click();
        }
      });
    }
    async _loadPrefs() {
      if (!chrome?.storage?.local) return;
      try {
        const prefs = await chrome.storage.local.get([
          "canvas_brush_color",
          "canvas_brush_size"
        ]);
        if (prefs.canvas_brush_color) {
          this.engine.setColor(prefs.canvas_brush_color);
          this.shadow.getElementById("color-picker").value = prefs.canvas_brush_color;
        }
        if (prefs.canvas_brush_size) {
          const size = Number(prefs.canvas_brush_size);
          this.engine.setBrushSize(size);
          this.shadow.getElementById("radius-slider").value = size;
          this.shadow.getElementById("radius-value").textContent = size;
          this._updateCursorPreviewSize(size);
        }
      } catch (e) {
      }
    }
    _savePref(key, value) {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.set({ [key]: value }).catch(() => {
      });
    }
  };

  // src/content.js
  var DEFAULT_WIDTH = 360;
  var MIN_WIDTH = 280;
  var MAX_WIDTH_RATIO = 0.5;
  var STORAGE_KEYS = {
    side: "canvas_panel_side",
    width: "canvas_panel_width"
  };
  var host = null;
  var shadowRoot = null;
  var panelController = null;
  var panelVisible = false;
  var panelSide = "right";
  var panelWidth = DEFAULT_WIDTH;
  var originalMargin = "";
  var isResizing = false;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_PANEL") {
      toggle();
    }
  });
  async function toggle() {
    if (!host) {
      await createPanel();
    }
    panelVisible = !panelVisible;
    host.style.display = panelVisible ? "block" : "none";
    updatePageMargin();
  }
  async function createPanel() {
    host = document.createElement("div");
    host.id = "canvas-ext-root";
    host.style.cssText = "all: initial; display: none;";
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: "closed" });
    const [htmlRes, cssRes] = await Promise.all([
      fetch(chrome.runtime.getURL("panel.html")),
      fetch(chrome.runtime.getURL("panel.css"))
    ]);
    const htmlText = await htmlRes.text();
    const cssText = await cssRes.text();
    const style = document.createElement("style");
    style.textContent = cssText;
    shadowRoot.appendChild(style);
    const wrapper = document.createElement("div");
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
    }
  }
  function savePref(key, value) {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.set({ [key]: value }).catch(() => {
    });
  }
  function applyPosition() {
    if (!host) return;
    const maxW = Math.floor(window.innerWidth * MAX_WIDTH_RATIO);
    panelWidth = Math.max(MIN_WIDTH, Math.min(panelWidth, maxW));
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.height = "100vh";
    host.style.width = panelWidth + "px";
    host.style.zIndex = "2147483647";
    if (panelSide === "left") {
      host.style.left = "0";
      host.style.right = "auto";
      shadowRoot.host.classList.add("panel-left");
    } else {
      host.style.right = "0";
      host.style.left = "auto";
      shadowRoot.host.classList.remove("panel-left");
    }
  }
  function updatePageMargin() {
    if (panelVisible) {
      if (panelSide === "right") {
        originalMargin = document.body.style.marginRight;
        document.body.style.marginRight = panelWidth + "px";
        document.body.style.marginLeft = "";
      } else {
        originalMargin = document.body.style.marginLeft;
        document.body.style.marginLeft = panelWidth + "px";
        document.body.style.marginRight = "";
      }
    } else {
      document.body.style.marginRight = "";
      document.body.style.marginLeft = "";
    }
  }
  function toggleSide() {
    panelSide = panelSide === "right" ? "left" : "right";
    savePref(STORAGE_KEYS.side, panelSide);
    applyPosition();
    updatePageMargin();
  }
  function setupResize() {
    const handle = shadowRoot.getElementById("resize-handle");
    if (!handle) return;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      isResizing = true;
      handle.classList.add("active");
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!isResizing) return;
      const maxW = Math.floor(window.innerWidth * MAX_WIDTH_RATIO);
      let newWidth;
      if (panelSide === "right") {
        newWidth = window.innerWidth - e.clientX;
      } else {
        newWidth = e.clientX;
      }
      newWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxW));
      panelWidth = newWidth;
      host.style.width = panelWidth + "px";
      updatePageMargin();
    });
    handle.addEventListener("pointerup", (e) => {
      if (!isResizing) return;
      isResizing = false;
      handle.classList.remove("active");
      handle.releasePointerCapture(e.pointerId);
      savePref(STORAGE_KEYS.width, panelWidth);
    });
  }
})();

(() => {
  // src/sidepanel.js
  var MAX_HISTORY = 30;
  var canvas = document.getElementById("drawing-canvas");
  var container = document.getElementById("canvas-wrap");
  var cursorRing = document.getElementById("cursor-ring");
  var gridOverlay = document.getElementById("grid-overlay");
  var ctx = canvas.getContext("2d", { willReadFrequently: true });
  var tool = "draw";
  var color = "#000000";
  var brushSize = 3;
  var isDrawing = false;
  var lastPt = null;
  var undoStack = [];
  var undoIdx = -1;
  var canvasBg = "#ffffff";
  var gridOn = false;
  var gridSize = 50;
  function resize() {
    const r = container.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const dpr = devicePixelRatio || 1;
    const old = document.createElement("canvas");
    old.width = canvas.width;
    old.height = canvas.height;
    old.getContext("2d").drawImage(canvas, 0, 0);
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    canvas.style.width = r.width + "px";
    canvas.style.height = r.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, r.width, r.height);
    if (old.width > 0 && old.height > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(old, 0, 0);
      ctx.restore();
    }
  }
  function pushUndo() {
    if (canvas.width === 0 || canvas.height === 0) return;
    undoStack = undoStack.slice(0, undoIdx + 1);
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    undoIdx = undoStack.length - 1;
    updateUndoRedo();
  }
  function restoreUndo() {
    const s = undoStack[undoIdx];
    if (!s) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(s, 0, 0);
    ctx.restore();
    updateUndoRedo();
  }
  function pt(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = pt(e);
    isDrawing = true;
    lastPt = p;
    canvas.setPointerCapture(e.pointerId);
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const evts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evts) {
      const p = pt(ev);
      ctx.beginPath();
      ctx.moveTo(lastPt.x, lastPt.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastPt = p;
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    lastPt = null;
    canvas.releasePointerCapture(e.pointerId);
    ctx.globalCompositeOperation = "source-over";
    pushUndo();
  });
  container.addEventListener("pointermove", (e) => {
    const r = container.getBoundingClientRect();
    cursorRing.style.left = e.clientX - r.left + "px";
    cursorRing.style.top = e.clientY - r.top + "px";
    cursorRing.style.display = "block";
  });
  container.addEventListener("pointerleave", () => cursorRing.style.display = "none");
  function setCursorSize(s) {
    cursorRing.style.width = s + "px";
    cursorRing.style.height = s + "px";
  }
  var drawBtn = document.getElementById("tool-draw");
  var eraseBtn = document.getElementById("tool-erase");
  var undoBtn = document.getElementById("tool-undo");
  var redoBtn = document.getElementById("tool-redo");
  var colorPicker = document.getElementById("color-picker");
  var slider = document.getElementById("radius-slider");
  var sliderVal = document.getElementById("radius-val");
  var clearBtn = document.getElementById("tool-clear");
  var toolBtns = [drawBtn, eraseBtn];
  function setTool(btn, t) {
    toolBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tool = t;
  }
  drawBtn.onclick = () => setTool(drawBtn, "draw");
  eraseBtn.onclick = () => setTool(eraseBtn, "erase");
  colorPicker.addEventListener("input", (e) => {
    color = e.target.value;
    save("canvas_brush_color", color);
  });
  undoBtn.onclick = () => {
    if (undoIdx > 0) {
      undoIdx--;
      restoreUndo();
    }
  };
  redoBtn.onclick = () => {
    if (undoIdx < undoStack.length - 1) {
      undoIdx++;
      restoreUndo();
    }
  };
  clearBtn.onclick = () => {
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = container.getBoundingClientRect();
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, r.width, r.height);
    pushUndo();
  };
  slider.addEventListener("input", (e) => {
    brushSize = +e.target.value;
    sliderVal.textContent = brushSize;
    setCursorSize(brushSize);
    save("canvas_brush_size", brushSize);
  });
  function updateUndoRedo() {
    undoBtn.disabled = undoIdx <= 0;
    redoBtn.disabled = undoIdx >= undoStack.length - 1;
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      redoBtn.click();
    } else if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      undoBtn.click();
    } else if (e.key === "d" && !e.ctrlKey && !e.metaKey) {
      drawBtn.click();
    } else if (e.key === "e" && !e.ctrlKey && !e.metaKey) {
      eraseBtn.click();
    }
  });
  var pasteBtn = document.getElementById("paste-btn");
  var statusEl = document.getElementById("status");
  pasteBtn.addEventListener("click", async () => {
    pasteBtn.disabled = true;
    setStatus("Pasting...", "");
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const response = await chrome.runtime.sendMessage({
        type: "PASTE_IMAGE",
        imageData: dataUrl
      });
      if (response && response.success) {
        setStatus("Pasted!", "success");
      } else {
        setStatus(response?.error || "Failed", "error");
      }
    } catch (e) {
      setStatus(e.message || "Failed to paste", "error");
    } finally {
      pasteBtn.disabled = false;
    }
  });
  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = (cls || "") + " visible";
    if (cls === "success" || cls === "error") {
      setTimeout(() => {
        statusEl.className = "";
        statusEl.textContent = "";
      }, 2500);
    }
  }
  var settingsBtn = document.getElementById("tool-settings");
  var settingsDialog = document.getElementById("settings-dialog");
  var settingsClose = document.getElementById("settings-close");
  var bgWhiteBtn = document.getElementById("bg-white");
  var bgBlackBtn = document.getElementById("bg-black");
  var gridToggle = document.getElementById("grid-toggle");
  settingsBtn.onclick = () => settingsDialog.showModal();
  settingsClose.onclick = () => settingsDialog.close();
  settingsDialog.addEventListener("click", (e) => {
    if (e.target === settingsDialog) settingsDialog.close();
  });
  function setBg(bg, repaint) {
    const oldBg = canvasBg;
    canvasBg = bg;
    container.style.background = canvasBg;
    if (bg === "#ffffff") {
      bgWhiteBtn.classList.add("selected");
      bgBlackBtn.classList.remove("selected");
      cursorRing.classList.remove("light");
    } else {
      bgBlackBtn.classList.add("selected");
      bgWhiteBtn.classList.remove("selected");
      cursorRing.classList.add("light");
    }
    if (repaint && canvas.width > 0 && canvas.height > 0) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      const oldR = parseInt(oldBg.slice(1, 3), 16), oldG = parseInt(oldBg.slice(3, 5), 16), oldB = parseInt(oldBg.slice(5, 7), 16);
      const newR = parseInt(bg.slice(1, 3), 16), newG = parseInt(bg.slice(3, 5), 16), newB = parseInt(bg.slice(5, 7), 16);
      const tol = 10;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - oldR) <= tol && Math.abs(d[i + 1] - oldG) <= tol && Math.abs(d[i + 2] - oldB) <= tol && d[i + 3] > 240) {
          d[i] = newR;
          d[i + 1] = newG;
          d[i + 2] = newB;
        }
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(imgData, 0, 0);
      ctx.restore();
      pushUndo();
    }
    updateGrid();
    save("canvas_bg_color", canvasBg);
  }
  bgWhiteBtn.onclick = () => setBg("#ffffff", true);
  bgBlackBtn.onclick = () => setBg("#000000", true);
  var gridSizeSlider = document.getElementById("grid-size-slider");
  var gridSizeVal = document.getElementById("grid-size-val");
  gridToggle.onclick = () => {
    gridOn = !gridOn;
    gridToggle.classList.toggle("on", gridOn);
    updateGrid();
    save("canvas_grid", gridOn);
  };
  gridSizeSlider.addEventListener("input", (e) => {
    gridSize = +e.target.value;
    gridSizeVal.textContent = gridSize;
    updateGrid();
    save("canvas_grid_size", gridSize);
  });
  function updateGrid() {
    if (gridOn) {
      const color2 = canvasBg === "#000000" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
      gridOverlay.style.backgroundImage = `linear-gradient(${color2} 1px, transparent 1px), linear-gradient(90deg, ${color2} 1px, transparent 1px)`;
      gridOverlay.style.backgroundSize = `${gridSize}px ${gridSize}px`;
      gridOverlay.style.display = "block";
    } else {
      gridOverlay.style.display = "none";
    }
  }
  function save(k, v) {
    chrome.storage?.local?.set({ [k]: v }).catch(() => {
    });
  }
  async function loadPrefs() {
    try {
      const p = await chrome.storage.local.get(["canvas_brush_size", "canvas_brush_color", "canvas_bg_color", "canvas_grid", "canvas_grid_size"]);
      if (p.canvas_brush_size) {
        brushSize = +p.canvas_brush_size;
        slider.value = brushSize;
        sliderVal.textContent = brushSize;
        setCursorSize(brushSize);
      }
      if (p.canvas_brush_color) {
        color = p.canvas_brush_color;
        colorPicker.value = color;
      }
      if (p.canvas_bg_color) {
        setBg(p.canvas_bg_color, false);
      }
      if (p.canvas_grid_size) {
        gridSize = +p.canvas_grid_size;
        gridSizeSlider.value = gridSize;
        gridSizeVal.textContent = gridSize;
      }
      if (p.canvas_grid) {
        gridOn = true;
        gridToggle.classList.add("on");
        updateGrid();
      }
    } catch {
    }
  }
  function init() {
    resize();
    pushUndo();
    setCursorSize(brushSize);
    loadPrefs();
  }
  requestAnimationFrame(() => {
    init();
    new ResizeObserver(() => resize()).observe(container);
  });
})();

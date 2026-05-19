(() => {
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
    const host = window.location.hostname;
    if (host === "claude.ai") return new ClaudeAdapter();
    if (host === "chatgpt.com" || host === "chat.openai.com") return new ChatGPTAdapter();
    if (host === "gemini.google.com") return new GeminiAdapter();
    throw new Error(`Unsupported site: ${host}`);
  }

  // src/content.js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PASTE_IMAGE") {
      handlePaste(msg.imageData).then(() => sendResponse({ success: true })).catch((e) => sendResponse({ success: false, error: e.message }));
      return true;
    }
  });
  async function handlePaste(imageDataUrl) {
    const blob = await dataUrlToBlob(imageDataUrl);
    const adapter = getAdapter();
    await adapter.attachImage(blob);
  }
  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then((r) => r.blob());
  }
})();

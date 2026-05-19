(() => {
  // src/background.js
  chrome.action.onClicked.addListener(async (tab) => {
    await chrome.sidePanel.open({ tabId: tab.id });
  });
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PASTE_IMAGE") {
      relayPaste(msg.imageData).then((res) => sendResponse(res)).catch((e) => sendResponse({ success: false, error: e.message }));
      return true;
    }
  });
  async function relayPaste(imageData) {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs || !tabs[0]) throw new Error("No active tab found");
    const tabId = tabs[0].id;
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: pasteImageInPage,
      args: [imageData]
    });
    const result = results?.[0]?.result;
    if (!result) throw new Error("Script execution returned no result");
    if (result.error) throw new Error(result.error);
    return { success: true };
  }
  async function pasteImageInPage(imageDataUrl) {
    try {
      const parts = imageDataUrl.split(",");
      const mime = parts[0].match(/:(.*?);/)[1];
      const b64 = atob(parts[1]);
      const bytes = new Uint8Array(b64.length);
      for (let i = 0; i < b64.length; i++) bytes[i] = b64.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const fileNum = Date.now() % 1e5;
      const file = new File([blob], "drawing-" + fileNum + ".png", { type: "image/png" });
      const host = window.location.hostname;
      if (host === "gemini.google.com") {
        return geminiPaste(file);
      } else if (host === "claude.ai") {
        return claudePaste(file);
      } else if (host === "chatgpt.com" || host === "chat.openai.com") {
        return chatgptPaste(file);
      }
      return { error: "Unsupported site: " + host };
    } catch (e) {
      return { error: e.message || "Paste failed" };
    }
    function geminiPaste(file) {
      const editor = document.querySelector('.ql-editor[contenteditable="true"]') || document.querySelector('div[contenteditable="true"][role="textbox"]') || document.querySelector('[contenteditable="true"]');
      if (editor) {
        editor.focus();
        const dt = new DataTransfer();
        dt.items.add(file);
        editor.dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt })
        );
        return { success: true };
      }
      return { error: "Could not find Gemini chat input" };
    }
    function claudePaste(file) {
      const fileInput = document.querySelector("#chat-input-file-upload-bottom") || document.querySelector('input[type="file"]');
      if (fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }
      return { error: "Could not find Claude file input" };
    }
    function chatgptPaste(file) {
      const editor = document.querySelector('#prompt-textarea[contenteditable="true"]') || document.querySelector("#prompt-textarea") || document.querySelector('[contenteditable="true"]');
      if (editor) {
        editor.focus();
        const dt = new DataTransfer();
        dt.items.add(file);
        editor.dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt })
        );
        return { success: true };
      }
      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }
      return { error: "Could not find ChatGPT chat input" };
    }
  }
})();

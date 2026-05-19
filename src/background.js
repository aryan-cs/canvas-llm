// Open the side panel when the toolbar icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Relay messages from the side panel — execute paste in the page's MAIN world
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PASTE_IMAGE') {
    relayPaste(msg.imageData, false)
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }
  if (msg.type === 'PASTE_AND_SUBMIT_IMAGE') {
    relayPaste(msg.imageData, true)
      .then((res) => sendResponse(res))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

async function relayPaste(imageData, submit) {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs || !tabs[0]) throw new Error('No active tab found');

  const tabId = tabs[0].id;

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: pasteImageInPage,
    args: [imageData, !!submit],
  });

  const result = results?.[0]?.result;
  if (!result) throw new Error('Script execution returned no result');
  if (result.error) throw new Error(result.error);
  return { success: true };
}

// This function is serialized and runs in the PAGE's main world.
async function pasteImageInPage(imageDataUrl, submit) {
  try {
    // Convert data URL to blob WITHOUT fetch() — fetch(dataUrl) is blocked by CSP on most sites
    const parts = imageDataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const b64 = atob(parts[1]);
    const bytes = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) bytes[i] = b64.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const fileNum = Date.now() % 100000;
    const file = new File([blob], 'drawing-' + fileNum + '.png', { type: 'image/png' });

    const host = window.location.hostname;
    let pasteResult;

    if (host === 'gemini.google.com') {
      pasteResult = geminiPaste(file);
    } else if (host === 'claude.ai') {
      pasteResult = claudePaste(file);
    } else if (host === 'chatgpt.com' || host === 'chat.openai.com') {
      pasteResult = chatgptPaste(file);
    } else {
      return { error: 'Unsupported site: ' + host };
    }

    if (pasteResult.error) return pasteResult;
    if (!submit) return pasteResult;

    // Submit: wait for the send button to become enabled (image upload complete),
    // then click it.
    const getSendBtn = sendBtnFinder(host);
    const btn = await waitForEnabled(getSendBtn, 20000);
    btn.click();
    return { success: true };
  } catch (e) {
    return { error: e.message || 'Paste failed' };
  }

  function sendBtnFinder(host) {
    if (host === 'claude.ai') {
      return () => document.querySelector('button[aria-label="Send message"]')
        || document.querySelector('button[aria-label="Send Message"]');
    }
    if (host === 'chatgpt.com' || host === 'chat.openai.com') {
      return () => document.querySelector('#composer-submit-button')
        || document.querySelector('button[data-testid="send-button"]')
        || document.querySelector('button[aria-label*="Send" i]');
    }
    if (host === 'gemini.google.com') {
      return () => document.querySelector('button.send-button')
        || document.querySelector('button[aria-label*="Send" i]');
    }
    return () => null;
  }

  function isEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function isUploadInProgress() {
    // Common upload-in-progress indicators across chat sites
    if (document.querySelector('[role="progressbar"]')) return true;
    if (document.querySelector('mat-progress-spinner, mat-progress-bar')) return true;
    if (document.querySelector('[aria-label*="uploading" i], [aria-label*="loading" i]')) return true;
    return false;
  }

  function waitForEnabled(getBtn, maxMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      // Initial delay so the disabled state / upload indicator can appear
      setTimeout(function poll() {
        const btn = getBtn();
        if (isEnabled(btn) && !isUploadInProgress()) {
          // Hold for a brief stable window — confirms the upload really
          // settled (not just a momentary gap between progress indicators)
          setTimeout(() => {
            const btn2 = getBtn();
            if (isEnabled(btn2) && !isUploadInProgress()) { resolve(btn2); return; }
            // Still uploading — keep polling
            if (Date.now() - start > maxMs) {
              reject(new Error('Image upload timed out'));
              return;
            }
            setTimeout(poll, 150);
          }, 400);
          return;
        }
        if (Date.now() - start > maxMs) {
          reject(new Error('Image upload timed out — send button never enabled'));
          return;
        }
        setTimeout(poll, 150);
      }, 400);
    });
  }

  function geminiPaste(file) {
    // Strategy 1: file input (most reliable — triggers Gemini's real upload flow)
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    // Prefer inputs that accept images
    const imageInput = fileInputs.find(i => {
      const accept = (i.accept || '').toLowerCase();
      return accept.includes('image') || accept.includes('*') || !accept;
    }) || fileInputs[0];
    if (imageInput) {
      const dt = new DataTransfer();
      dt.items.add(file);
      imageInput.files = dt.files;
      imageInput.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }

    // Strategy 2: synthetic drag/drop on a dropzone
    const dropzone =
      document.querySelector('.xap-uploader-dropzone') ||
      document.querySelector('[class*="dropzone" i]') ||
      document.querySelector('.ql-editor[contenteditable="true"]');
    if (dropzone) {
      const dt = new DataTransfer();
      dt.items.add(file);
      const dragOpts = { bubbles: true, cancelable: true, dataTransfer: dt };
      dropzone.dispatchEvent(new DragEvent('dragenter', dragOpts));
      dropzone.dispatchEvent(new DragEvent('dragover', dragOpts));
      dropzone.dispatchEvent(new DragEvent('drop', dragOpts));
      return { success: true };
    }

    // Strategy 3: clipboard paste on editor (last resort)
    const editor =
      document.querySelector('.ql-editor[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"]');
    if (editor) {
      editor.focus();
      const dt = new DataTransfer();
      dt.items.add(file);
      editor.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })
      );
      return { success: true };
    }
    return { error: 'Could not find Gemini chat input' };
  }

  function claudePaste(file) {
    // Use the hidden file input (Claude's TipTap editor ignores synthetic paste events)
    const fileInput =
      document.querySelector('#chat-input-file-upload-bottom') ||
      document.querySelector('input[type="file"]');
    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }
    return { error: 'Could not find Claude file input' };
  }

  function chatgptPaste(file) {
    // Strategy 1: paste on the editor
    const editor =
      document.querySelector('#prompt-textarea[contenteditable="true"]') ||
      document.querySelector('#prompt-textarea') ||
      document.querySelector('[contenteditable="true"]');
    if (editor) {
      editor.focus();
      const dt = new DataTransfer();
      dt.items.add(file);
      editor.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })
      );
      return { success: true };
    }
    // Strategy 2: set files on the upload input
    const fileInput =
      document.querySelector('input[type="file"]');
    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }
    return { error: 'Could not find ChatGPT chat input' };
  }
}

import { getAdapter } from './adapters/index.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PASTE_IMAGE') {
    handlePaste(msg.imageData)
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true; // keep channel open for async
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

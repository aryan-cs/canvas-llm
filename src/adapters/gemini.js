import {
  queryWithFallbacks,
  createFileFromBlob,
  dispatchDropEvent,
  dispatchPasteEvent,
  waitForEnabled,
  sleep,
} from './base.js';

const INPUT_SELECTORS = [
  '.ql-editor[contenteditable="true"]',
  'div[contenteditable="true"][aria-label*="prompt"]',
  'div[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
];

const DROP_TARGET_SELECTORS = [
  '.xap-uploader-dropzone',
  '.input-area-container',
  '.chat-input-container',
];

const SEND_SELECTORS = [
  '.send-button',
  'button[aria-label="Send message"]',
  'button[aria-label*="Send"]',
  'button.send-button',
];

export class GeminiAdapter {
  findInput() {
    return queryWithFallbacks(INPUT_SELECTORS);
  }

  async attachImage(blob) {
    const file = createFileFromBlob(blob);

    const dropTarget = queryWithFallbacks(DROP_TARGET_SELECTORS);
    if (dropTarget) {
      dispatchDropEvent(dropTarget, file);
      return;
    }

    const editor = this.findInput();
    if (!editor) throw new Error('Could not find Gemini chat input');
    dispatchPasteEvent(editor, file);
  }

  async waitForImageReady() {
    await sleep(2000);
    const sendBtn = queryWithFallbacks(SEND_SELECTORS);
    if (sendBtn && sendBtn.disabled) {
      await waitForEnabled(sendBtn, 15000);
    }
  }

  async insertText(text) {
    const editor = this.findInput();
    if (!editor) throw new Error('Could not find Gemini chat input');
    editor.focus();
    await sleep(100);
    document.execCommand('insertText', false, text);
  }

  async submit() {
    await sleep(500);
    const sendBtn = queryWithFallbacks(SEND_SELECTORS);
    if (!sendBtn) throw new Error('Could not find Gemini send button');
    if (sendBtn.disabled) {
      await waitForEnabled(sendBtn, 10000);
    }
    sendBtn.click();
  }
}

import {
  queryWithFallbacks,
  createFileFromBlob,
  setFilesOnInput,
  dispatchPasteEvent,
  waitForEnabled,
  sleep,
} from './base.js';

const INPUT_SELECTORS = [
  '[data-testid="chat-input"]',
  '.tiptap.ProseMirror',
  'div.ProseMirror[contenteditable="true"]',
  '[contenteditable="true"]',
];

const FILE_INPUT_SELECTORS = [
  'input[type="file"][data-testid]',
  'input[type="file"]',
];

const SEND_SELECTORS = [
  'button[aria-label="Send Message"]',
  'button[aria-label="Send message"]',
  '[data-testid="send-button"]',
  'button[aria-label*="Send"]',
];

export class ClaudeAdapter {
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
    if (!editor) throw new Error('Could not find Claude chat input');
    dispatchPasteEvent(editor, file);
  }

  async waitForImageReady() {
    await sleep(1000);
    const sendBtn = queryWithFallbacks(SEND_SELECTORS);
    if (sendBtn && sendBtn.disabled) {
      await waitForEnabled(sendBtn, 15000);
    }
  }

  async insertText(text) {
    const editor = this.findInput();
    if (!editor) throw new Error('Could not find Claude chat input');
    editor.focus();
    await sleep(100);
    document.execCommand('insertText', false, text);
  }

  async submit() {
    await sleep(300);
    const sendBtn = queryWithFallbacks(SEND_SELECTORS);
    if (!sendBtn) throw new Error('Could not find Claude send button');
    if (sendBtn.disabled) {
      await waitForEnabled(sendBtn, 10000);
    }
    sendBtn.click();
  }
}

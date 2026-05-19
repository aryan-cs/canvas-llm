import {
  queryWithFallbacks,
  createFileFromBlob,
  setFilesOnInput,
  dispatchPasteEvent,
  waitForEnabled,
  sleep,
} from './base.js';

const INPUT_SELECTORS = [
  '#prompt-textarea',
  'div.ProseMirror[contenteditable="true"]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
];

const FILE_INPUT_SELECTORS = [
  '#upload-files',
  '#upload-photos',
  'input[type="file"][multiple]',
  'input[type="file"]',
];

const SEND_SELECTORS = [
  '[data-testid="send-button"]',
  '#composer-submit-button',
  'button[aria-label="Send prompt"]',
  'button[aria-label*="Send"]',
];

export class ChatGPTAdapter {
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
    if (!editor) throw new Error('Could not find ChatGPT chat input');
    dispatchPasteEvent(editor, file);
  }

  async waitForImageReady() {
    await sleep(1500);
    const sendBtn = queryWithFallbacks(SEND_SELECTORS);
    if (sendBtn && sendBtn.disabled) {
      await waitForEnabled(sendBtn, 15000);
    }
  }

  async insertText(text) {
    const editor = this.findInput();
    if (!editor) throw new Error('Could not find ChatGPT chat input');
    editor.focus();
    await sleep(100);
    document.execCommand('insertText', false, text);
  }

  async submit() {
    await sleep(300);
    const sendBtn = queryWithFallbacks(SEND_SELECTORS);
    if (!sendBtn) throw new Error('Could not find ChatGPT send button');
    if (sendBtn.disabled) {
      await waitForEnabled(sendBtn, 10000);
    }
    sendBtn.click();
  }
}

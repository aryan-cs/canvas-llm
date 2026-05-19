export function queryWithFallbacks(selectors) {
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch (e) {
      // invalid selector, skip
    }
  }
  return null;
}

export function createFileFromBlob(blob, filename = 'canvas-drawing.png') {
  return new File([blob], filename, { type: 'image/png' });
}

export function setFilesOnInput(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function dispatchPasteEvent(target, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  });
  target.dispatchEvent(event);
}

export function dispatchDropEvent(target, file) {
  const dt = new DataTransfer();
  dt.items.add(file);

  target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
}

export function waitForEnabled(element, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!element) return reject(new Error('Element not found'));
    if (!element.disabled) return resolve(element);

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timed out waiting for send button to become enabled'));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      if (!element.disabled) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(element);
      }
    });

    observer.observe(element, { attributes: true, attributeFilter: ['disabled'] });
  });
}

export function waitForElement(selectors, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const existing = queryWithFallbacks(selectors);
    if (existing) return resolve(existing);

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timed out waiting for element: ' + selectors.join(', ')));
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const el = queryWithFallbacks(selectors);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

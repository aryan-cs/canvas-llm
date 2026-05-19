# canvas-llm

A Chrome extension that adds a drawing canvas side panel to AI chat sites. Sketch something, hit send, and it gets pasted directly into the chat.

## Supported sites

- [Claude](https://claude.ai)
- [ChatGPT](https://chatgpt.com)
- [Gemini](https://gemini.google.com)

## Install

1. Clone this repo
2. Run `npm install && npm run build`
3. Open `chrome://extensions` and enable **Developer mode**
4. Click **Load unpacked** and select the `dist/` folder

## Usage

Click the extension icon in the Chrome toolbar (or press `Cmd+Shift+D` / `Ctrl+Shift+D`) to open the side panel.

### Toolbar

| Button | Description |
|--------|-------------|
| **Pen** | Freehand drawing tool |
| **Eraser** | Removes strokes |
| **Color** | Pick a brush color |
| **Size slider** | Adjust brush/eraser radius (1-40px) |
| **Undo / Redo** | Step through drawing history |
| **Reset** | Clear the entire canvas |
| **Settings** | Open settings menu |

### Keyboard shortcuts

- `D` &mdash; switch to draw
- `E` &mdash; switch to eraser
- `Ctrl+Z` / `Cmd+Z` &mdash; undo
- `Ctrl+Shift+Z` / `Cmd+Shift+Z` &mdash; redo

### Settings

- **Background** &mdash; toggle between white and black canvas
- **Grid** &mdash; overlay a reference grid on the canvas
- **Grid size** &mdash; adjust grid square size (10-60px)

### Sending a drawing

Click the arrow button in the bottom-right corner of the canvas. Your drawing gets pasted as an image directly into the chat input of whichever supported site is open in the active tab.

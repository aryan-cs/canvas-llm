/* ── PeerJS Host (extension side) ── */
import Peer from 'peerjs';

export class PeerHost {
  constructor(opts = {}) {
    this.onStateChange = opts.onStateChange || (() => {});
    this.onImageReceived = opts.onImageReceived || (() => {});
    this.onDrawEvent = opts.onDrawEvent || (() => {});
    this.onPasteRequest = opts.onPasteRequest || (() => {});
    this.onAction = opts.onAction || (() => {});
    this.onSettings = opts.onSettings || (() => {});
    this.onView = opts.onView || (() => {});
    this.onRemoteConnected = opts.onRemoteConnected || (() => {});
    this.onError = opts.onError || (() => {});

    this._peer = null;
    this._conn = null;
    this._state = 'idle';
  }

  getState() { return this._state; }
  getPeerId() { return this._peer?.id || null; }

  getShareUrl() {
    const id = this.getPeerId();
    if (!id) return null;
    return `https://aryan-cs.github.io/canvas-llm/#peer=${id}`;
  }

  _setState(s) {
    this._state = s;
    this.onStateChange(s);
  }

  start() {
    return new Promise((resolve, reject) => {
      this._setState('initializing');

      this._peer = new Peer();

      this._peer.on('open', (id) => {
        this._setState('ready');
        resolve(id);
      });

      this._peer.on('connection', (conn) => {
        // Only allow one connection at a time
        if (this._conn) {
          this._conn.close();
        }
        this._conn = conn;
        this._setState('connected');

        conn.on('data', (msg) => {
          if (msg && msg.type === 'image' && msg.data) {
            this._setState('transferring');
            this._blobToDataUrl(msg.data).then(async (dataUrl) => {
              let result;
              try {
                result = await this.onImageReceived(dataUrl);
              } catch (e) {
                result = { success: false, error: e?.message || 'paste failed' };
              }
              this._setState('connected');
              try {
                conn.send({
                  type: 'image-ack',
                  success: !!(result && result.success),
                  error: result && result.error ? result.error : null,
                });
              } catch {}
            });
          } else if (msg && msg.type === 'draw' && msg.event) {
            this.onDrawEvent(msg.event);
          } else if (msg && msg.type === 'action' && msg.action) {
            this.onAction(msg.action);
          } else if (msg && msg.type === 'settings' && msg.settings) {
            this.onSettings(msg.settings);
          } else if (msg && msg.type === 'view') {
            this.onView(msg.view);
          } else if (msg && msg.type === 'paste') {
            this.onPasteRequest();
            try { conn.send({ type: 'paste-ack' }); } catch {}
          } else if (msg && msg.type === 'hello') {
            try { conn.send({ type: 'welcome' }); } catch {}
            // Notify host so it can send initial state
            this.onRemoteConnected();
          }
        });

        conn.on('close', () => {
          this._conn = null;
          this._setState('ready'); // Back to waiting for connections
        });

        conn.on('error', (err) => {
          this.onError(err);
        });
      });

      this._peer.on('error', (err) => {
        this.onError(err);
        if (this._state === 'initializing') {
          this._setState('error');
          reject(err);
        }
      });

      this._peer.on('disconnected', () => {
        // Lost connection to signaling server, try reconnect
        if (this._peer && !this._peer.destroyed) {
          this._peer.reconnect();
        }
      });
    });
  }

  sendDrawEvent(event) {
    if (this._conn && this._conn.open) {
      this._conn.send({ type: 'draw', event });
    }
  }

  sendAction(action) {
    if (this._conn && this._conn.open) {
      this._conn.send({ type: 'action', action });
    }
  }

  sendSettings(settings) {
    if (this._conn && this._conn.open) {
      this._conn.send({ type: 'settings', settings });
    }
  }

  sendView(view) {
    if (this._conn && this._conn.open) {
      this._conn.send({ type: 'view', view });
    }
  }

  sendInit(strokes, settings) {
    if (this._conn && this._conn.open) {
      this._conn.send({ type: 'init', strokes, settings });
    }
  }

  sendPasteAvailable(available) {
    if (this._conn && this._conn.open) {
      this._conn.send({ type: 'paste-available', available: !!available });
    }
  }

  stop() {
    if (this._conn) {
      this._conn.close();
      this._conn = null;
    }
    if (this._peer) {
      this._peer.destroy();
      this._peer = null;
    }
    this._setState('idle');
  }

  async _blobToDataUrl(data) {
    // data could be Blob, ArrayBuffer, or base64 string
    let blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data instanceof ArrayBuffer) {
      blob = new Blob([data], { type: 'image/png' });
    } else if (typeof data === 'string') {
      // Already a data URL
      return data;
    } else {
      // PeerJS may send as ArrayBuffer via binary serialization
      blob = new Blob([new Uint8Array(data)], { type: 'image/png' });
    }

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }
}

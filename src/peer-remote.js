/* ── PeerJS Remote (phone side) ── */
import Peer from 'peerjs';

export class PeerRemote {
  constructor(hostPeerId, opts = {}) {
    this._hostPeerId = hostPeerId;
    this.onStateChange = opts.onStateChange || (() => {});
    this.onError = opts.onError || (() => {});
    this.onAck = opts.onAck || (() => {});
    this.onPasteAck = opts.onPasteAck || (() => {});
    this.onAction = opts.onAction || (() => {});
    this.onDrawEvent = opts.onDrawEvent || (() => {});
    this.onSettings = opts.onSettings || (() => {});
    this.onView = opts.onView || (() => {});
    this.onInit = opts.onInit || (() => {});
    this.onPasteAvailable = opts.onPasteAvailable || (() => {});

    this._peer = null;
    this._conn = null;
    this._state = 'idle';
  }

  getState() { return this._state; }

  _setState(s) {
    this._state = s;
    this.onStateChange(s);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._setState('connecting');

      this._peer = new Peer();

      this._peer.on('open', () => {
        // Now connect to the host
        this._conn = this._peer.connect(this._hostPeerId, { reliable: true });

        this._conn.on('open', () => {
          this._setState('connected');
          this._conn.send({ type: 'hello' });
          resolve();
        });

        this._conn.on('data', (msg) => {
          if (msg && msg.type === 'image-ack') {
            this.onAck({ success: !!msg.success, error: msg.error || null });
          } else if (msg && msg.type === 'paste-ack') {
            this.onPasteAck();
          } else if (msg && msg.type === 'action' && msg.action) {
            this.onAction(msg.action);
          } else if (msg && msg.type === 'draw' && msg.event) {
            this.onDrawEvent(msg.event);
          } else if (msg && msg.type === 'settings' && msg.settings) {
            this.onSettings(msg.settings);
          } else if (msg && msg.type === 'view') {
            this.onView(msg.view);
          } else if (msg && msg.type === 'init') {
            this.onInit(msg.strokes, msg.settings);
          } else if (msg && msg.type === 'paste-available') {
            this.onPasteAvailable(!!msg.available);
          }
        });

        this._conn.on('close', () => {
          this._conn = null;
          this._setState('disconnected');
        });

        this._conn.on('error', (err) => {
          this.onError(err);
          this._setState('error');
        });
      });

      this._peer.on('error', (err) => {
        this.onError(err);
        if (this._state === 'connecting') {
          this._setState('error');
          reject(err);
        }
      });

      // Timeout after 15s
      setTimeout(() => {
        if (this._state === 'connecting') {
          this._setState('error');
          reject(new Error('Connection timed out'));
        }
      }, 15000);
    });
  }

  sendDrawEvent(event) {
    if (!this._conn || this._conn.open === false) return;
    this._conn.send({ type: 'draw', event });
  }

  sendAction(action) {
    if (!this._conn || this._conn.open === false) return;
    this._conn.send({ type: 'action', action });
  }

  sendSettings(settings) {
    if (!this._conn || this._conn.open === false) return;
    this._conn.send({ type: 'settings', settings });
  }

  sendView(view) {
    if (!this._conn || this._conn.open === false) return;
    this._conn.send({ type: 'view', view });
  }

  requestPaste() {
    if (!this._conn || this._conn.open === false) {
      throw new Error('Not connected');
    }
    this._conn.send({ type: 'paste' });
  }

  async sendImage(blob, opts = {}) {
    if (!this._conn || this._conn.open === false) {
      throw new Error('Not connected');
    }
    this._setState('sending');
    const buf = await blob.arrayBuffer();
    this._conn.send({ type: 'image', data: buf, submit: !!opts.submit });
    this._setState('connected');
  }

  disconnect() {
    if (this._conn) { this._conn.close(); this._conn = null; }
    if (this._peer) { this._peer.destroy(); this._peer = null; }
    this._setState('disconnected');
  }
}

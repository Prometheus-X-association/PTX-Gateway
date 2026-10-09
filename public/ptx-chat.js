/* PTX chat web component. The shared React chat runtime lives in an isolated iframe. */
(() => {
  if (customElements.get("ptx-chat")) return;
  class PtxChat extends HTMLElement {
    static get observedAttributes() { return ["src", "org", "drawer-id", "token"]; }
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._context = {};
      this._ready = false;
      this._receive = (event) => {
        if (!this._frame || event.source !== this._frame.contentWindow || event.origin !== this._origin) return;
        const allowed = ["ptx-chat:ready", "ptx-chat:opened", "ptx-chat:closed", "ptx-chat:result-change", "ptx-chat:document-change", "ptx-chat:error"];
        if (!allowed.includes(event.data?.type)) return;
        if (event.data.type === "ptx-chat:ready") { this._ready = true; this._send("ptx-chat:context", this._context); }
        this.dispatchEvent(new CustomEvent(event.data.type, { detail: event.data.detail, bubbles: true, composed: true }));
      };
    }
    connectedCallback() { window.addEventListener("message", this._receive); this._render(); }
    disconnectedCallback() { window.removeEventListener("message", this._receive); this._ready = false; }
    attributeChangedCallback() { if (this.isConnected) this._render(); }
    get context() { return this._context; }
    set context(value) { this._context = value || {}; if (this._ready) this._send("ptx-chat:context", this._context); }
    open() { this._send("ptx-chat:open"); }
    close() { this._send("ptx-chat:close"); }
    _send(type, detail) { this._frame?.contentWindow?.postMessage({ type, detail }, this._origin); }
    _render() {
      this._ready = false;
      this._frame = null;
      this.shadowRoot.replaceChildren();
      const source = this.getAttribute("src");
      const org = this.getAttribute("org");
      const id = this.getAttribute("drawer-id");
      if (!source || !org || !id) { this.shadowRoot.textContent = "Set src, org and drawer-id to load PTX chat."; return; }
      let url;
      try {
        url = new URL(source);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid origin");
        this._origin = url.origin;
        url = new URL(`/chat/embed/${encodeURIComponent(org)}/${encodeURIComponent(id)}`, this._origin);
        url.hash = new URLSearchParams({ token: this.getAttribute("token") || "" }).toString();
      } catch { this.shadowRoot.textContent = "Invalid PTX chat source URL."; return; }
      const style = document.createElement("style");
      style.textContent = ":host{display:block;min-height:320px;height:640px}iframe{display:block;width:100%;height:100%;border:0}";
      const frame = document.createElement("iframe");
      frame.title = "PTX AI assistant";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.src = url.toString();
      this._frame = frame;
      this.shadowRoot.append(style, frame);
    }
  }
  customElements.define("ptx-chat", PtxChat);
})();

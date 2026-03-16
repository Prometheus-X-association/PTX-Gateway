// PDC Gateway Web Component
// This allows the gateway to be embedded in external websites

import React from 'react';
import ReactDOM from 'react-dom/client';

// Gateway component wrapper for embedding
export class PDCGatewayElement extends HTMLElement {
  private root: ReactDOM.Root | null = null;
  private mountPoint: HTMLDivElement | null = null;

  static get observedAttributes() {
    return ['org-slug', 'theme', 'token'];
  }

  connectedCallback() {
    // Create shadow DOM for style isolation
    const shadow = this.attachShadow({ mode: 'open' });
    
    // Create mount point
    this.mountPoint = document.createElement('div');
    this.mountPoint.style.width = '100%';
    this.mountPoint.style.height = '100%';
    shadow.appendChild(this.mountPoint);
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        width: 100%;
        min-height: 600px;
      }
    `;
    shadow.appendChild(style);
    
    this.render();
  }

  disconnectedCallback() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  attributeChangedCallback() {
    this.render();
  }

  private render() {
    if (!this.mountPoint) return;
    
    const orgSlug = this.getAttribute('org-slug');
    const theme = this.getAttribute('theme') || 'dark';
    const token = this.getAttribute('token');
    
    // Create or update the iframe
    let iframe = this.mountPoint.querySelector('iframe');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      this.mountPoint.appendChild(iframe);
    }
    
    // Build the embed URL
    const baseUrl = window.location.origin;
    const embedUrl = new URL('/embed', baseUrl);
    if (orgSlug) embedUrl.searchParams.set('org', orgSlug);
    if (theme) embedUrl.searchParams.set('theme', theme);
    if (token) embedUrl.searchParams.set('token', token);
    
    iframe.src = embedUrl.toString();
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('pdc-gateway')) {
  customElements.define('pdc-gateway', PDCGatewayElement);
}

// Export for manual registration
export const registerPDCGateway = () => {
  if (!customElements.get('pdc-gateway')) {
    customElements.define('pdc-gateway', PDCGatewayElement);
  }
};

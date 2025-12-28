/**
 * @getsigil/core - Visual markers for automated UI testing
 * https://usesigil.dev
 */

export interface SigilConfig {
  /** Enable/disable Sigil markers */
  enabled?: boolean;
  /** Marker position: 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right' */
  position?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Z-index for markers */
  zIndex?: number;
  /** Marker opacity (0-1) */
  opacity?: number;
  /** WebSocket port for executor communication */
  wsPort?: number;
}

export interface MarkerEncoding {
  borderColor: number;
  cellColors: number[];
}

// 8-color palette for marker encoding
const HEX_COLORS = [
  "#FF0000", "#FFFF00", "#00FF00", "#00FFFF",
  "#0000FF", "#FF00FF", "#FFFFFF", "#000000"
];

// Elements that cannot have visible children
const NO_CHILD_ELEMENTS = [
  'INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'BR', 'HR',
  'META', 'LINK', 'AREA', 'BASE', 'COL', 'EMBED',
  'PARAM', 'SOURCE', 'TRACK', 'WBR'
];

class SigilCore {
  private config: Required<SigilConfig> = {
    enabled: true,
    position: 'center',
    zIndex: 9999,
    opacity: 1,
    wsPort: 5050
  };

  private observer: MutationObserver | null = null;
  private wsConnection: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setInterval> | null = null;
  private markedElements = new WeakSet<Element>();
  private initialized = false;

  /**
   * Initialize Sigil with configuration
   */
  init(options: SigilConfig = {}): void {
    // Check URL for custom WebSocket port
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlWsPort = urlParams.get('sigilWsPort');
      if (urlWsPort) {
        options.wsPort = parseInt(urlWsPort, 10);
        options.opacity = options.opacity ?? 1;
      }
    }

    this.config = { ...this.config, ...options };

    if (!this.config.enabled) return;

    this.injectStyles();
    this.scan();
    this.startObserver();
    this.connectWebSocket();
    this.initialized = true;
  }

  /**
   * Update configuration
   */
  configure(options: Partial<SigilConfig>): void {
    this.config = { ...this.config, ...options };

    if (!this.config.enabled) {
      this.stopObserver();
      this.removeAllMarkers();
    } else {
      this.scan();
      this.startObserver();
    }
  }

  /**
   * Scan DOM and add markers to elements with data-sigil-id
   */
  scan(root: Document | Element = document): void {
    if (!this.config.enabled) return;

    const elements = root.querySelectorAll('[data-sigil-id]');
    elements.forEach(el => this.addMarker(el as HTMLElement));
  }

  /**
   * Auto-discover interactive elements and add data-sigil-id attributes
   */
  autoDiscover(): void {
    const selectors = [
      'button',
      'a[href]',
      'input:not([type="hidden"])',
      'textarea',
      'select',
      '[role="button"]',
      '[role="checkbox"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="switch"]'
    ];

    const allElements: Element[] = [];
    selectors.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(el => allElements.push(el));
      } catch { /* ignore */ }
    });

    const uniqueElements = [...new Set(allElements)]
      .filter(el => !el.hasAttribute('data-sigil-id'));

    const usedIds = new Set<string>();
    document.querySelectorAll('[data-sigil-id]').forEach(el => {
      usedIds.add(el.getAttribute('data-sigil-id')!);
    });

    let counter = 0;
    uniqueElements.forEach(el => {
      const id = this.generateElementId(el as HTMLElement, counter++, usedIds);
      if (id) {
        el.setAttribute('data-sigil-id', id);
        usedIds.add(id);
      }
    });

    console.log(`Sigil: Auto-discovered ${counter} interactive elements`);
    this.scan();
  }

  /**
   * Show all markers
   */
  show(): void {
    document.querySelectorAll('.sigil-marker').forEach(m => {
      (m as HTMLElement).style.opacity = '1';
    });
  }

  /**
   * Hide all markers
   */
  hide(): void {
    document.querySelectorAll('.sigil-marker').forEach(m => {
      (m as HTMLElement).style.opacity = '0';
    });
  }

  /**
   * Clean up and remove all markers
   */
  dispose(): void {
    this.stopObserver();
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    if (this.wsReconnectTimer) {
      clearInterval(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    this.removeAllMarkers();
    this.initialized = false;
  }

  /**
   * Check if Sigil is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  // ========== Private Methods ==========

  private injectStyles(): void {
    if (document.getElementById('sigil-styles')) return;

    const style = document.createElement('style');
    style.id = 'sigil-styles';
    style.textContent = `
      .mud-dialog, .mud-dialog-content, .mud-dialog-actions,
      .modal-content, .modal-body, .modal-footer, .modal-header,
      .rz-dialog, .rz-dialog-content,
      [class*="dialog-content"], [class*="modal-content"], [class*="popup-content"] {
        overflow: visible !important;
      }
    `;
    document.head.appendChild(style);
  }

  private async addMarker(element: HTMLElement): Promise<void> {
    if (this.markedElements.has(element)) return;
    if (!this.config.enabled) return;

    const markerId = element.getAttribute('data-sigil-id');
    if (!markerId) return;

    this.markedElements.add(element);

    const encoding = await this.encode(markerId);
    const svgContent = this.createMarkerSvg(encoding);

    const marker = document.createElement('div');
    marker.className = 'sigil-marker';
    marker.innerHTML = svgContent;
    marker.setAttribute('data-sigil-for', markerId);

    const canHaveChildren = !NO_CHILD_ELEMENTS.includes(element.tagName);

    if (canHaveChildren) {
      const computedStyle = window.getComputedStyle(element);
      if (computedStyle.position === 'static') {
        element.style.position = 'relative';
      }
      element.style.overflow = 'visible';

      const pos = this.getPositionStyles();
      Object.assign(marker.style, {
        position: 'absolute',
        ...pos,
        zIndex: this.config.zIndex.toString(),
        opacity: this.config.opacity.toString(),
        pointerEvents: 'none',
        lineHeight: '0'
      });

      element.appendChild(marker);
    } else {
      const updatePosition = () => {
        const rect = element.getBoundingClientRect();
        Object.assign(marker.style, {
          position: 'fixed',
          top: (rect.top + rect.height / 2 - 8) + 'px',
          left: (rect.left + rect.width / 2 - 8) + 'px',
          zIndex: this.config.zIndex.toString(),
          opacity: this.config.opacity.toString(),
          pointerEvents: 'none',
          lineHeight: '0'
        });
      };

      updatePosition();
      document.body.appendChild(marker);

      window.addEventListener('scroll', updatePosition, { passive: true });
      window.addEventListener('resize', updatePosition, { passive: true });
    }
  }

  private getPositionStyles(): Record<string, string> {
    const positions: Record<string, Record<string, string>> = {
      'center': { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
      'top-left': { top: '0', left: '0' },
      'top-right': { top: '0', right: '0' },
      'bottom-left': { bottom: '0', left: '0' },
      'bottom-right': { bottom: '0', right: '0' }
    };
    return positions[this.config.position] || positions['center'];
  }

  private async encode(markerId: string): Promise<MarkerEncoding> {
    const hash = await this.sha256(markerId);
    const borderColor = hash[0] & 0x07;
    const cellColors: number[] = [];

    for (let i = 0; i < 9; i++) {
      const byteIndex = 1 + Math.floor((i * 3) / 8);
      const bitOffset = (i * 3) % 8;
      let value: number;
      if (bitOffset <= 5) {
        value = (hash[byteIndex] >> bitOffset) & 0x07;
      } else {
        value = ((hash[byteIndex] >> bitOffset) | (hash[byteIndex + 1] << (8 - bitOffset))) & 0x07;
      }
      cellColors.push(value);
    }

    return { borderColor, cellColors };
  }

  private async sha256(message: string): Promise<Uint8Array> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return new Uint8Array(hashBuffer);
  }

  private createMarkerSvg(encoding: MarkerEncoding): string {
    const borderHex = HEX_COLORS[encoding.borderColor];
    let svg = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; shape-rendering: crispEdges;">`;

    // Anchor pattern (2x2 magenta/cyan)
    svg += `<rect x="0" y="0" width="1" height="1" fill="#FF00FF"/>`;
    svg += `<rect x="1" y="0" width="1" height="1" fill="#00FFFF"/>`;
    svg += `<rect x="0" y="1" width="1" height="1" fill="#00FFFF"/>`;
    svg += `<rect x="1" y="1" width="1" height="1" fill="#FF00FF"/>`;

    // Border
    svg += `<rect x="2" y="0" width="14" height="2" fill="${borderHex}"/>`;
    svg += `<rect x="0" y="2" width="2" height="12" fill="${borderHex}"/>`;
    svg += `<rect x="14" y="2" width="2" height="12" fill="${borderHex}"/>`;
    svg += `<rect x="0" y="14" width="16" height="2" fill="${borderHex}"/>`;

    // 3x3 grid
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const idx = row * 3 + col;
        const x = 2 + col * 4;
        const y = 2 + row * 4;
        const cellHex = HEX_COLORS[encoding.cellColors[idx]];
        svg += `<rect x="${x}" y="${y}" width="4" height="4" fill="${cellHex}"/>`;
      }
    }

    svg += `</svg>`;
    return svg;
  }

  private generateElementId(el: HTMLElement, index: number, usedIds: Set<string>): string | null {
    const tag = el.tagName.toLowerCase();
    const isFormElement = ['input', 'textarea', 'select', 'button'].includes(tag);

    const sanitize = (str: string): string =>
      str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 30);

    if (isFormElement) {
      // Try id attribute
      let id = el.id;
      if (id) {
        id = sanitize(id);
        if (!usedIds.has(id)) return id;
        id = `${tag}-${id}`;
        if (!usedIds.has(id)) return id;
      }

      // Try name attribute
      id = el.getAttribute('name') || '';
      if (id) {
        id = sanitize(id);
        if (!usedIds.has(id)) return id;
        id = `${tag}-${id}`;
        if (!usedIds.has(id)) return id;
      }

      // Try aria-label
      id = el.getAttribute('aria-label') || '';
      if (id) {
        id = sanitize(id);
        if (!usedIds.has(id)) return id;
      }

      // Try placeholder
      id = el.getAttribute('placeholder') || '';
      if (id) {
        id = sanitize(id);
        if (!usedIds.has(id)) return id;
      }
    } else {
      // Try aria-label
      let id = el.getAttribute('aria-label') || '';
      if (id) {
        id = sanitize(id);
        if (!usedIds.has(id)) return id;
      }

      // Try text content
      const text = el.textContent?.trim() || '';
      if (text && text.length <= 30) {
        id = sanitize(text);
        if (!usedIds.has(id)) return id;
      }

      // Try href for links
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        if (href && href !== '#') {
          id = sanitize(href.replace(/^[#/]+/, ''));
          if (id && !usedIds.has(id)) return id;
        }
      }
    }

    // Fallback
    let id = `${tag}-${index}`;
    while (usedIds.has(id)) {
      id = `${tag}-${++index}`;
    }
    return id;
  }

  private startObserver(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (el.hasAttribute?.('data-sigil-id')) {
              this.addMarker(el);
            }
            this.scan(el);
          }
        });
      });
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  private stopObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  private removeAllMarkers(): void {
    document.querySelectorAll('.sigil-marker').forEach(m => m.remove());
  }

  private connectWebSocket(): void {
    if (typeof WebSocket === 'undefined') return;
    if (this.wsConnection?.readyState === WebSocket.OPEN) return;

    try {
      this.wsConnection = new WebSocket(`ws://127.0.0.1:${this.config.wsPort}`);

      this.wsConnection.onopen = () => {
        console.log('Sigil: Connected to executor');
        if (this.wsReconnectTimer) {
          clearInterval(this.wsReconnectTimer);
          this.wsReconnectTimer = null;
        }
      };

      this.wsConnection.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

      this.wsConnection.onclose = () => {
        if (!this.wsReconnectTimer) {
          this.wsReconnectTimer = setInterval(() => this.connectWebSocket(), 2000);
        }
      };

      this.wsConnection.onerror = () => {
        // WebSocket errors are common when executor isn't running
      };
    } catch {
      // WebSocket not available
    }
  }

  private handleWebSocketMessage(data: string): void {
    const cmd = data.trim();
    const cmdLower = cmd.toLowerCase();

    if (cmdLower === 'show') {
      this.show();
    } else if (cmdLower === 'hide') {
      this.hide();
    } else if (cmdLower.startsWith('search:')) {
      const markerId = cmd.substring(7);
      const result = this.searchForMarker(markerId);
      this.sendResult(result);
    } else if (cmdLower.startsWith('scrollto:')) {
      const markerId = cmd.substring(9);
      this.scrollToMarker(markerId);
    } else if (cmdLower.startsWith('read:text:')) {
      const markerId = cmd.substring(10);
      const result = this.readTextContent(markerId);
      this.sendResult(result);
    } else if (cmdLower.startsWith('read:value:')) {
      const markerId = cmd.substring(11);
      const result = this.readInputValue(markerId);
      this.sendResult(result);
    } else if (cmdLower.startsWith('select:')) {
      const parts = cmd.substring(7).split(':');
      const markerId = parts[0];
      const optionValue = parts.slice(1).join(':');
      Promise.resolve(this.selectOption(markerId, optionValue)).then(result => {
        this.sendResult(result);
      });
    } else if (cmdLower.startsWith('check:')) {
      const markerId = cmd.substring(6);
      const result = this.setCheckboxState(markerId, true);
      this.sendResult(result);
    } else if (cmdLower.startsWith('uncheck:')) {
      const markerId = cmd.substring(8);
      const result = this.setCheckboxState(markerId, false);
      this.sendResult(result);
    }
  }

  private searchForMarker(markerId: string): object {
    const element = document.querySelector(`[data-sigil-id="${markerId}"]`);
    if (!element) {
      return { found: false, visible: false, markerId };
    }

    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const markerBottom = rect.bottom + 16;

    const inViewport = (
      rect.bottom > 0 &&
      markerBottom < viewportHeight &&
      rect.left < viewportWidth &&
      rect.right > 0
    );

    return {
      found: true,
      visible: inViewport,
      markerId,
      direction: inViewport ? null : this.getDirection(rect, viewportWidth, viewportHeight),
      offsetX: 0,
      offsetY: 0
    };
  }

  private getDirection(rect: DOMRect, vw: number, vh: number): string {
    let dir = '';
    if (rect.bottom < 0) dir = 'up';
    else if (rect.bottom + 16 > vh) dir = 'down';
    if (rect.right < 0) dir += dir ? '-left' : 'left';
    else if (rect.left > vw) dir += dir ? '-right' : 'right';
    return dir || 'down';
  }

  private scrollToMarker(markerId: string): void {
    const element = document.querySelector(`[data-sigil-id="${markerId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
  }

  private readTextContent(markerId: string): object {
    const element = document.querySelector(`[data-sigil-id="${markerId}"]`);
    if (!element) return { success: false, value: '', error: 'Element not found' };
    return { success: true, value: element.textContent?.trim() || '' };
  }

  private readInputValue(markerId: string): object {
    const element = document.querySelector(`[data-sigil-id="${markerId}"]`) as HTMLInputElement;
    if (!element) return { success: false, value: '', error: 'Element not found' };

    const input = element.querySelector('input, textarea, select') as HTMLInputElement || element;
    return { success: true, value: input.value || '' };
  }

  private selectOption(markerId: string, optionValue: string): object | Promise<object> {
    const element = document.querySelector(`[data-sigil-id="${markerId}"]`) as HTMLSelectElement;
    if (!element) return { success: false, error: 'Element not found' };

    const select = element.querySelector('select') as HTMLSelectElement || element;
    if (select.tagName === 'SELECT') {
      const option = Array.from(select.options).find(
        opt => opt.value === optionValue || opt.text.trim() === optionValue
      );
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      }
    }

    // Custom dropdown - click to open, then click option
    element.click();
    return new Promise(resolve => {
      setTimeout(() => {
        const options = document.querySelectorAll('[role="option"], .dropdown-item, li');
        for (const opt of options) {
          if (opt.textContent?.trim() === optionValue) {
            (opt as HTMLElement).click();
            resolve({ success: true });
            return;
          }
        }
        resolve({ success: false, error: 'Option not found' });
      }, 200);
    });
  }

  private setCheckboxState(markerId: string, shouldCheck: boolean): object {
    const element = document.querySelector(`[data-sigil-id="${markerId}"]`) as HTMLInputElement;
    if (!element) return { success: false, error: 'Element not found' };

    const checkbox = element.querySelector('input[type="checkbox"]') as HTMLInputElement || element;
    if (checkbox.type === 'checkbox' && checkbox.checked !== shouldCheck) {
      checkbox.click();
    }
    return { success: true };
  }

  private sendResult(result: object): void {
    if (this.wsConnection?.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify(result));
    }
  }
}

// Create singleton instance
const sigil = new SigilCore();

// Export for different module systems
export { sigil as Sigil };
export default sigil;

// Auto-initialize if in browser with window.Sigil
if (typeof window !== 'undefined') {
  (window as any).Sigil = sigil;
}

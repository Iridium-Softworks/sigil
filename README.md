# @getsigil/core

Visual markers for automated UI testing - client-side library for [Sigil](https://usesigil.dev).

This package renders visual glyph markers on interactive elements, enabling zero-config browser automation with the Sigil executor.

## Installation

```bash
npm install @getsigil/core
```

## Usage

### Automatic (Default)

The Sigil executor automatically injects this library via CDP. No installation required.

```bash
sigil run test.sigil --address http://localhost:3000
```

Elements with `sig`, `data-sigil-id`, or `data-testid` attributes are observed and prioritized over auto-generated IDs, giving you explicit control when needed.

Use `--no-inject` to disable automatic script injection if you prefer manual integration.

### Manual Integration

For projects using `--no-inject`, or when you need markers without the executor:

```javascript
import { Sigil } from '@getsigil/core';

// Initialize (typically in development only)
Sigil.init({
  enabled: process.env.NODE_ENV === 'development',
  wsPort: 5050
});
```

Then add attributes to elements you want to mark:

```html
<button sig="submit-btn">Submit</button>
<input sig="email-input" type="email" />
```

Supported attributes (in priority order): `sig`, `data-sigil-id`, `data-testid`.

### Auto-Discovery

For recording scripts interactively (not typical for most automation workflows):

```javascript
import { Sigil } from '@getsigil/core';

Sigil.init({ enabled: true });
Sigil.autoDiscover(); // Marks buttons, inputs, links, etc.
```

## API

### `Sigil.init(config)`

Initialize the marker system.

```typescript
interface SigilConfig {
  enabled?: boolean;      // Enable/disable markers (default: true)
  wsPort?: number;        // WebSocket port for executor (default: 5050)
}
```

### `Sigil.scan(root?)`

Scan DOM for elements with `sig`, `data-sigil-id`, or `data-testid` attributes and add markers. Called automatically on init.

### `Sigil.autoDiscover()`

Auto-discover interactive elements and generate IDs for unmarked elements.

### `Sigil.show()` / `Sigil.hide()`

Toggle marker visibility.

### `Sigil.dispose()`

Clean up all markers and disconnect.

## Framework Examples

### React

```jsx
import { useEffect } from 'react';
import { Sigil } from '@getsigil/core';

function App() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      Sigil.init({ enabled: true });
    }
    return () => Sigil.dispose();
  }, []);

  return (
    <button sig="submit">Submit</button>
  );
}
```

### Vue

```vue
<script setup>
import { onMounted, onUnmounted } from 'vue';
import { Sigil } from '@getsigil/core';

onMounted(() => {
  if (import.meta.env.DEV) {
    Sigil.init({ enabled: true });
  }
});

onUnmounted(() => Sigil.dispose());
</script>

<template>
  <button sig="submit">Submit</button>
</template>
```

### Vanilla JS

```html
<script type="module">
  import { Sigil } from 'https://unpkg.com/@getsigil/core';
  Sigil.init({ enabled: true });
</script>

<button sig="submit">Submit</button>
```

## How It Works

Sigil renders small colored glyph markers on elements with `sig`, `data-sigil-id`, or `data-testid` attributes. Each marker encodes the element's ID using a unique color pattern that the Sigil executor can detect via screenshot analysis - no DOM access required.

This enables reliable UI automation that works with any web framework, including those with shadow DOM, iframes, or complex rendering.

## License

MIT

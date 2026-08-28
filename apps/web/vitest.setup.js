// vitest.setup.js
// Bridges global Jest functions to Vitest equivalents for backward compatibility.

import { vi } from 'vitest';

globalThis.jest = vi;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { vi } from 'vitest';

// Obsidian mock is handled via alias in vitest.config.ts pointing to tests/obsidian-mock.ts

// Mock window properties if needed
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'ResizeObserver', {
        writable: true,
        value: vi.fn().mockImplementation(() => ({
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        })),
    });
}

// Mock inversion: the real prototype patch, not a lossy stand-in. The version this
// replaced dropped attr/type/placeholder/value/title and supported only one of the
// three createDiv call forms, so tests could pass against DOM the app never builds.
import { installDomExtensions } from '../src/obsidian-shim/dom/dom-extensions';
installDomExtensions();

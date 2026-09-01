import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        globals: true,
        alias: {
            'obsidian': path.resolve(__dirname, './tests/obsidian-mock.ts'),
            'host-impl': path.resolve(__dirname, './src/host/impl.ts'),
            '../main': path.resolve(__dirname, './main.ts'),
        },
    },
});

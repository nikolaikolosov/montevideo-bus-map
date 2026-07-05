import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/js/**/*.test.js'],
        setupFiles: ['tests/js/setup.js'],
        environment: 'node',
    },
});

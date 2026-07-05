import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'tests/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                L: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
    {
        files: ['tests/js/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: ['tests/e2e/**/*.js', 'playwright.config.js', 'vitest.config.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
    },
];

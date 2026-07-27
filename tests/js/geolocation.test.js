/**
 * Follow-and-retry policy for the position tracking (src/map.js).
 *
 * The tracking loop itself — timers, permissions, visibility — is browser
 * integration and is covered in tests/e2e/geolocation.spec.js. The two
 * decisions it takes are pure and pinned here: when the camera may still be
 * moved, and which geolocation errors are worth another try.
 */

import { describe, it, expect } from 'vitest';

import { cameraLeftAnchor, isFatalLocationError } from '../../src/map.js';

describe('cameraLeftAnchor (whether following may continue)', () => {
    const anchor = { hash: '', lat: -34.9055, lng: -56.187, zoom: 16 };

    it('keeps following while the camera is exactly where we left it', () => {
        expect(cameraLeftAnchor(anchor, { ...anchor })).toBe(false);
    });

    it('stops following once the rider pans', () => {
        expect(cameraLeftAnchor(anchor, { ...anchor, lat: -34.9075 })).toBe(true);
        expect(cameraLeftAnchor(anchor, { ...anchor, lng: -56.19 })).toBe(true);
    });

    it('stops following once the rider zooms', () => {
        expect(cameraLeftAnchor(anchor, { ...anchor, zoom: 15 })).toBe(true);
    });

    it('stops following once a line is opened', () => {
        // The ride scenario: the rider picks the line they are on, which frames
        // the whole route. Re-centring at zoom 16 every 30 s would undo that.
        expect(cameraLeftAnchor(anchor, { ...anchor, hash: '#/line/199' })).toBe(true);
    });

    it('tolerates float noise below Leaflet’s own epsilon', () => {
        expect(cameraLeftAnchor(anchor, { ...anchor, lat: anchor.lat + 1e-12 })).toBe(false);
        expect(cameraLeftAnchor(anchor, { ...anchor, lat: anchor.lat + 1e-7 })).toBe(true);
    });

    it('never follows without an anchor', () => {
        expect(cameraLeftAnchor(null, { ...anchor })).toBe(true);
    });
});

describe('isFatalLocationError (whether to keep polling)', () => {
    it('gives up on a denied permission', () => {
        // Retrying every 30 s would never succeed and keeps the GPS awake.
        expect(isFatalLocationError(1)).toBe(true); // PERMISSION_DENIED
    });

    it('keeps polling through transient failures', () => {
        // A bus under a bridge or a cold GPS: the next poll may well succeed,
        // which is the whole point of polling.
        expect(isFatalLocationError(2)).toBe(false); // POSITION_UNAVAILABLE
        expect(isFatalLocationError(3)).toBe(false); // TIMEOUT
    });
});

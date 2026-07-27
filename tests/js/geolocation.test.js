/**
 * Follow-and-retry policy for the position tracking (src/map.js).
 *
 * The tracking loop itself — timers, permissions, visibility — is browser
 * integration and is covered in tests/e2e/geolocation.spec.js. The two
 * decisions it takes are pure and pinned here: when the camera may still be
 * moved, and which geolocation errors are worth another try.
 */

import { describe, it, expect } from 'vitest';

import { cameraLeftAnchor, isFatalLocationError, nextRefreshMs } from '../../src/map.js';
import { CONFIG } from '../../src/config.js';

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

describe('nextRefreshMs (how often to read the position)', () => {
    // The budget is half a p10 stop gap: past that, the map implies the wrong
    // stop. Measured over 59,751 stop pairs — qa/reports/geolocation-cadence-report.md.
    const M_PER_DEG_LAT = 111000;
    const at = 1_000_000;
    /** A fix `metres` north of `from`, `seconds` later. */
    const after = (from, metres, seconds, accuracy = 10) => ({
        lat: from.lat + metres / M_PER_DEG_LAT,
        lng: from.lng,
        accuracy,
        at: from.at + seconds * 1000,
    });
    const origin = { lat: -34.9055, lng: -56.187, accuracy: 10, at };

    it('assumes a riding cadence before any speed is known', () => {
        expect(nextRefreshMs(null, origin)).toBe(CONFIG.GEOLOCATION_FIRST_REFRESH_MS);
    });

    it('backs off to the cap when the rider is not moving', () => {
        // Standing at a stop: position is not changing, so reading it again
        // buys nothing but the news that motion resumed.
        expect(nextRefreshMs(origin, after(origin, 0, 15))).toBe(CONFIG.GEOLOCATION_MAX_REFRESH_MS);
    });

    it('does not mistake GPS jitter for motion', () => {
        // A stationary phone wanders inside its own error circle. Treating that
        // as speed would hold the GPS at full rate next to a bus stop.
        expect(nextRefreshMs(origin, after(origin, 18, 15, 25))).toBe(
            CONFIG.GEOLOCATION_MAX_REFRESH_MS,
        );
    });

    it('speeds up to keep half a stop gap while riding', () => {
        // 20 km/h = 5.56 m/s over 15 s = 83 m of travel.
        const ms = nextRefreshMs(origin, after(origin, 83 + 10, 15));
        expect(ms).toBeGreaterThan(12_000);
        expect(ms).toBeLessThan(20_000);
    });

    it('never reads faster than the floor, however fast the bus is', () => {
        // 60 km/h: the budget would ask for 5 s, but below the floor extra
        // reads stop buying anything measurable.
        expect(nextRefreshMs(origin, after(origin, 250 + 10, 15))).toBe(
            CONFIG.GEOLOCATION_MIN_REFRESH_MS,
        );
    });

    it('walking does not need a fast cadence, so the cap applies', () => {
        // 4.5 km/h = 1.25 m/s: half a gap takes over a minute to cover, so the
        // cap applies — walking simply does not need a fast cadence.
        expect(nextRefreshMs(origin, after(origin, 19 + 10, 15))).toBe(
            CONFIG.GEOLOCATION_MAX_REFRESH_MS,
        );
    });

    it('ignores a non-advancing clock instead of dividing by zero', () => {
        expect(nextRefreshMs(origin, { ...origin })).toBe(CONFIG.GEOLOCATION_FIRST_REFRESH_MS);
    });
});

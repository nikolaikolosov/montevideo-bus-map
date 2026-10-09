/**
 * Which way the buses leave a stop (src/stop-direction.js) — what tells apart
 * the two kerbs of a corner that share one name.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildIndexes, uniqueStopsData } from '../../src/data.js';
import { resetJourneyGeometry } from '../../src/journey-geometry.js';
import {
    departureBearing,
    agreedBearing,
    compassOf,
    stopDirection,
    resetStopDirections,
} from '../../src/stop-direction.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('departureBearing', () => {
    // ~1 m per 1e-5 degrees at this scale; 100 m legs.
    const east = [
        [0, 0],
        [0.001, 0],
    ];
    const north = [
        [0, 0],
        [0, 0.001],
    ];

    it('measures clockwise from north', () => {
        expect(departureBearing(east, 0)).toBeCloseTo(90, 6);
        expect(departureBearing(north, 0)).toBeCloseTo(0, 6);
        expect(departureBearing([...north].reverse(), 0)).toBeCloseTo(180, 6);
    });

    it('follows the trace AFTER the position, round a corner', () => {
        // 10 m east, then north: the first 40 m leave mostly northwards.
        const corner = [
            [0, 0],
            [0.0001, 0],
            [0.0001, 0.001],
        ];
        const bearing = departureBearing(corner, 0);
        expect(bearing).toBeGreaterThan(0);
        expect(bearing).toBeLessThan(45);
    });

    it('has no direction at the very end of a trace', () => {
        expect(departureBearing(east, 0.99)).toBeNull(); // 1 m left
    });
});

describe('agreedBearing / compassOf', () => {
    it('averages on the circle, across north', () => {
        expect(agreedBearing([350, 10])).toBeCloseTo(0, 6);
        expect(compassOf(agreedBearing([350, 10]))).toBe('N');
    });

    it('refuses to name a direction the variants do not share', () => {
        expect(agreedBearing([0, 180])).toBeNull(); // they cancel out
        expect(agreedBearing([0, 100])).toBeNull(); // 50° either side of the mean
        expect(agreedBearing([0, 80])).toBeCloseTo(40, 6); // 40° either side: one direction
        expect(agreedBearing([])).toBeNull();
    });

    it('rounds to the nearest of eight points', () => {
        expect(compassOf(0)).toBe('N');
        expect(compassOf(22)).toBe('N');
        expect(compassOf(23)).toBe('NE');
        expect(compassOf(180)).toBe('S');
        expect(compassOf(270)).toBe('W');
        expect(compassOf(337.6)).toBe('N');
    });
});

describe('stopDirection (committed data)', () => {
    beforeAll(() => {
        const routesData = JSON.parse(readFileSync(join(ROOT, 'routes.json'), 'utf8'));
        const stopsData = JSON.parse(readFileSync(join(ROOT, 'stops.json'), 'utf8'));
        buildIndexes(routesData, stopsData);
        resetJourneyGeometry();
        resetStopDirections();
    });

    it('tells apart the two kerbs of Av Millán y Sitio Grande', () => {
        // Same corner, same name, opposite directions: 1480 and 3595.
        const a = stopDirection(1480);
        const b = stopDirection(3595);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        let d = Math.abs(a.bearing - b.bearing) % 360;
        if (d > 180) d = 360 - d;
        expect(d).toBeGreaterThan(135);
        expect(a.compass).not.toBe(b.compass);
    });

    it('names no direction where every line ends', () => {
        expect(stopDirection(4967)).toBeNull(); // terminal-only (route-invariants)
    });

    it('gives almost every stop a direction, and separates most same-name stops', () => {
        // 4,827 of 4,930 when measured (the rest are junctions and terminals).
        const named = uniqueStopsData.filter((f) => stopDirection(f.properties.COD_UBIC_P));
        expect(named.length / uniqueStopsData.length).toBeGreaterThan(0.95);

        const byName = new Map();
        for (const f of uniqueStopsData) {
            const key = `${f.properties.CALLE}|${f.properties.ESQUINA}`;
            if (!byName.has(key)) byName.set(key, []);
            byName.get(key).push(f.properties.COD_UBIC_P);
        }
        let groups = 0;
        let told = 0;
        for (const codes of byName.values()) {
            if (codes.length < 2) continue;
            groups++;
            const labels = codes.map((c) => stopDirection(c)?.compass ?? '?');
            if (new Set(labels).size === labels.length) told++;
        }
        // 1,096 of 1,230 when measured.
        expect(told / groups).toBeGreaterThan(0.85);
    });

    it('caches per stop', () => {
        expect(stopDirection(1480)).toBe(stopDirection(1480));
    });
});

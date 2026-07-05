/**
 * Corridor smoothness — the user-reported line-104 regression (2026-07-05).
 *
 * The measures live in scripts/route_oracles.mjs (DUPLICATE / KINK classes
 * of the artifact taxonomy, architecture/contracts/route-geometry-contract.md)
 * and are swept network-wide by `npm run verify:oracles`, which gates CI:
 * any artifact not covered by qa/route-geometry-whitelist.json fails there.
 * The frozen network ceilings that used to live in this file (142 duplicate
 * pairs / 27 kinks) are retired in favor of that per-finding gate.
 *
 * This suite keeps the original incident pinned: line 104's reported window
 * (stops 3355/3933/3934, 26 de Marzo between Rambla Armenia and Julio César)
 * must stay strictly clean, and the whole line near-clean — the one residual
 * duplicate pair on Rambla O'Higgins is a genuinely divided carriageway at
 * the merge threshold (lat ≈ 9 m, verdict REAL in the oracle report).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildIndexes, getFilteredRouteFeatures } from '../../src/data.js';
import { prepareRouteFeature } from '../../src/map.js';
import {
    buildLineGeometry,
    measureDuplicates,
    measureKinks,
} from '../../scripts/route_oracles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

beforeAll(() => {
    const routes = JSON.parse(readFileSync(join(root, 'routes.json'), 'utf8'));
    const stops = JSON.parse(readFileSync(join(root, 'stops.json'), 'utf8'));
    buildIndexes(routes, stops);
});

describe('corridor smoothness (line 104 incident)', () => {
    it('line 104 is clean in the reported window and near-clean overall', () => {
        const prepared = getFilteredRouteFeatures(['104'], null)
            .map((f) => prepareRouteFeature(f, null))
            .filter(Boolean);
        const { sections } = buildLineGeometry('104', prepared);
        const dupes = measureDuplicates(sections);
        const kinks = measureKinks(sections);

        // Reported window: strictly zero.
        const inWindow = (p) => p[0] >= -56.142 && p[0] <= -56.127;
        expect(
            dupes.filter((d) => inWindow(d.at)),
            JSON.stringify(dupes),
        ).toEqual([]);
        expect(
            kinks.filter((k) => inWindow(k.at)),
            JSON.stringify(kinks),
        ).toEqual([]);

        // Whole line: at most the one residual pair on Rambla O'Higgins.
        expect(dupes.length).toBeLessThanOrEqual(1);
        expect(kinks).toEqual([]);
    });
});

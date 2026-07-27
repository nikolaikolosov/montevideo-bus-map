import { describe, it, expect } from 'vitest';
import { buildSections, smoothPath, recentreNodes } from '../../src/bundling.js';
import { CONFIG } from '../../src/config.js';

/** Builds a route Feature along given [lon, lat] coords. */
const feature = (line, variant, coords) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: { DESC_LINEA: line, COD_VARIAN: variant, DESC_VARIA: variant },
});

/** Straight street along the lon axis: points every `step` degrees. */
const street = (n, { latJitter = 0, step = 0.0004, lat = 0, lon0 = 0 } = {}) =>
    Array.from({ length: n }, (_, i) => [lon0 + i * step, lat + latJitter]);

describe('buildSections', () => {
    it('returns one section for a single variant', () => {
        const sections = buildSections([feature('100', 'v1', street(6))]);
        expect(sections).toHaveLength(1);
        expect(sections[0].lines).toEqual(['100']);
        expect([...sections[0].variantsByLine.get('100')]).toEqual(['v1']);
    });

    it('merges two jittered variants of one line into one corridor', () => {
        // Second trace jitters sideways by less than BUNDLE_TOLERANCE_DEG
        const jitter = CONFIG.BUNDLE_TOLERANCE_DEG * 0.3;
        const sections = buildSections([
            feature('100', 'ida', street(6)),
            feature('100', 'vuelta', street(6, { latJitter: jitter })),
        ]);
        expect(sections).toHaveLength(1);
        expect(sections[0].lines).toEqual(['100']);
        expect([...sections[0].variantsByLine.get('100')].sort()).toEqual(['ida', 'vuelta']);
    });

    it('unifies sparse and dense traces of the same street', () => {
        const dense = street(9, { step: 0.0002 });
        const sparse = [dense[0], dense[4], dense[8]]; // same street, fewer vertices
        const sections = buildSections([
            feature('100', 'dense', dense),
            feature('100', 'sparse', sparse),
        ]);
        expect(sections).toHaveLength(1);
    });

    it('puts two lines sharing a corridor into one section, sorted', () => {
        const sections = buildSections([
            feature('7', 'a', street(6)),
            feature('100', 'b', street(6)),
        ]);
        expect(sections).toHaveLength(1);
        expect(sections[0].lines).toEqual(['7', '100']); // numeric-aware sort
    });

    it('keeps far-apart streets as separate sections', () => {
        const sections = buildSections([
            feature('100', 'a', street(6)),
            feature('200', 'b', street(6, { lat: 0.01 })), // ~1 km away
        ]);
        expect(sections).toHaveLength(2);
        const lineSets = sections.map((s) => s.lines.join(','));
        expect(lineSets.sort()).toEqual(['100', '200']);
    });

    it('returns an empty array for no usable geometry', () => {
        expect(buildSections([])).toEqual([]);
        expect(buildSections([feature('1', 'v', [[0, 0]])])).toEqual([]);
    });
});

describe('node re-centring on strands (brainstorm-008 PR-2)', () => {
    const SEP = 0.00013; // ≈ 14 m, the measured P90 ida/vuelta offset
    /** Gentle S-curve centreline, so simplification keeps interior vertices. */
    const centreY = (x) => 0.0004 * Math.sin(x / 0.0004);
    /**
     * The two carriageways of one line, sampled OUT OF PHASE: no vertex of one
     * lines up with a vertex of the other, which is what made clustering
     * phase-dependent and produced the sawtooth.
     */
    const pair = () => {
        const strand = (offset, phase) =>
            Array.from({ length: 24 }, (_, i) => {
                const x = i * 0.0002 + phase;
                return [x, centreY(x) + offset];
            });
        const feat = (coords, variant) => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: { DESC_LINEA: '1', COD_VARIAN: variant, DESC_VARIA: variant },
        });
        return [feat(strand(SEP / 2, 0), 'ida'), feat(strand(-SEP / 2, 0.0001), 'vuelta')];
    };

    it('leaves a lone strand where it is', () => {
        // Nothing to average against: a single carriageway must not be moved.
        const sections = buildSections([pair()[0]]);
        const pts = sections.flatMap((s) => s.coords);
        expect(pts.length).toBeGreaterThan(2);
        const worst = Math.max(...pts.map(([x, y]) => Math.abs(y - centreY(x) - SEP / 2)));
        // Only smoothing/simplification may move it, never the re-centring.
        expect(worst).toBeLessThan(CONFIG.BUNDLE_SMOOTH_MAX_SHIFT_DEG + 1e-9);
    });
});

describe('smoothPath (anti-sawtooth smoothing)', () => {
    it('flattens an alternating sawtooth while pinning the endpoints', () => {
        const saw = [
            [0, 0],
            [10, 5],
            [20, -5],
            [30, 5],
            [40, 0],
        ];
        const out = smoothPath(saw, 2, 100, 10);
        expect(out[0]).toEqual([0, 0]);
        expect(out[out.length - 1]).toEqual([40, 0]);
        const maxDev = Math.max(...out.slice(1, -1).map((p) => Math.abs(p[1])));
        expect(maxDev).toBeLessThan(2.5); // was 5 before smoothing
    });

    it('bounds the TOTAL displacement, not the per-pass step (audit G-1)', () => {
        // The clamp used to apply to each pass separately, so `passes`
        // multiplied the budget: 2 passes moved a vertex up to 2 × maxShift.
        // On the committed corridors 219 of 14,001 vertices ended up past the
        // documented budget, the worst by 21.65 m against 11.11 m — and
        // route_oracles.mjs derives CHORD_MAX_M = 30 from that very number.
        const step = 15;
        const saw = Array.from({ length: 15 }, (_, i) => [i * step, i % 2 ? 12 : -12]);
        const maxShift = 10;
        let moved = 0;
        for (const passes of [1, 2, 3, 8]) {
            const out = smoothPath(saw, passes, 100, maxShift);
            for (let i = 0; i < saw.length; i++) {
                const shift = Math.hypot(out[i][0] - saw[i][0], out[i][1] - saw[i][1]);
                if (shift > 1e-12) moved++;
                expect(shift, `passes=${passes} vertex ${i}`).toBeLessThanOrEqual(maxShift + 1e-9);
            }
        }
        // Not vacuous: vertices really are being moved, the clamp just binds.
        expect(moved).toBeGreaterThan(0);
    });

    it('leaves straight lines and short paths untouched', () => {
        const straight = [
            [0, 0],
            [10, 0],
            [20, 0],
        ];
        expect(smoothPath(straight, 2, 100, 10)).toEqual(straight);
        const short = [
            [0, 0],
            [5, 5],
        ];
        expect(smoothPath(short, 2, 100, 10)).toBe(short);
    });

    it('rounds a corner proportionally to the node spacing, not more', () => {
        const corner = [
            [0, 0],
            [30, 0],
            [30, 30],
        ];
        const out = smoothPath(corner, 2, 100, 20);
        const [cx, cy] = out[1];
        expect(Math.hypot(cx - 30, cy - 0)).toBeLessThan(17);
        expect(out[0]).toEqual([0, 0]);
        expect(out[2]).toEqual([30, 30]);
    });

    it('never moves a vertex flanked by long segments (sparse peripheral traces)', () => {
        // A km-scale corner of an L*/G* line must stay exactly put — the
        // original unguarded smoothing swept such corners hundreds of meters
        // off the street (route-invariants caught it).
        const sparse = [
            [0, 0],
            [1000, 0],
            [1000, 1000],
        ];
        expect(smoothPath(sparse, 2, 66, 10)).toEqual(sparse);
    });

    it('caps the displacement of any smoothed vertex', () => {
        const spike = [
            [0, 0],
            [30, 40], // 40 off the axis: uncapped Laplacian would move it ~20
            [60, 0],
        ];
        const out = smoothPath(spike, 1, 100, 5);
        const moved = Math.hypot(out[1][0] - 30, out[1][1] - 40);
        expect(moved).toBeLessThanOrEqual(5 + 1e-9);
    });
});

describe('recentreNodes accumulators', () => {
    // The graph cleanup that runs after re-centring recomputes a surviving node
    // from the raw cluster sums (`mergeNode`: np.x = np.sx / np.n), so if those
    // sums still describe the pre-re-centring cluster mean, every diamond merge
    // silently undoes re-centring and restores the phase-dependent position
    // R-REPRESENTATIVE exists to remove. That was the mechanism behind line
    // 180's residual WOBBLE: node 206 snapped 7.6 m back off the strand mean.
    const TOL = CONFIG.BUNDLE_TOLERANCE_DEG;

    /** Two carriageways ~14 m apart — the measured P90 ida/vuelta offset. */
    const strands = () => {
        const sep = 0.00013;
        return [
            { coords: Array.from({ length: 8 }, (_, i) => [i * 0.0003, sep / 2]) },
            { coords: Array.from({ length: 8 }, (_, i) => [i * 0.0003 + 0.00015, -sep / 2]) },
        ];
    };

    /** Nodes sitting on one carriageway, as vertex-phase clustering leaves them. */
    const nodesOnOneSide = () =>
        Array.from({ length: 6 }, (_, i) => {
            const x = i * 0.0003;
            const y = 0.00013 / 2;
            const n = 2; // two vertices clustered here
            return { x, y, sx: x * n, sy: y * n, n };
        });

    it('leaves sx/sy/n describing the re-centred position', () => {
        const nodes = nodesOnOneSide();
        const before = nodes.map((nd) => [nd.x, nd.y]);
        recentreNodes(nodes, strands(), TOL * 1.5);
        // Not vacuous: re-centring must actually have moved the nodes.
        const movedAny = nodes.some(
            (nd, i) => Math.hypot(nd.x - before[i][0], nd.y - before[i][1]) > 1e-7,
        );
        expect(movedAny).toBe(true);
        for (const nd of nodes) {
            expect(nd.sx / nd.n).toBeCloseTo(nd.x, 12);
            expect(nd.sy / nd.n).toBeCloseTo(nd.y, 12);
        }
    });

    it('survives a merge without reverting to the cluster mean', () => {
        const nodes = nodesOnOneSide();
        recentreNodes(nodes, strands(), TOL * 1.5);
        const [p, q] = [nodes[2], nodes[3]];
        const expected = [
            (p.x * p.n + q.x * q.n) / (p.n + q.n),
            (p.y * p.n + q.y * q.n) / (p.n + q.n),
        ];
        // Exactly what mergeNode does when it absorbs q into p.
        p.sx += q.sx;
        p.sy += q.sy;
        p.n += q.n;
        expect(p.sx / p.n).toBeCloseTo(expected[0], 12);
        expect(p.sy / p.n).toBeCloseTo(expected[1], 12);
    });
});

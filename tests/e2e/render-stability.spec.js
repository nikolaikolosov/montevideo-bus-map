/**
 * Things that must NOT change when something unrelated happens.
 *
 * Both cases here are audit findings whose symptom is a side effect: the render
 * is correct, and then an action that should only recolour or only highlight
 * quietly moves the camera or the draw order instead.
 */
import { test, expect } from '@playwright/test';
import { openMap, renderLine, renderStopRoutes, setView } from './helpers.js';

test('a theme flip recolours the line view without re-framing it', async ({ page }) => {
    // renderRoutes ends in fitBounds whenever there is no source stop, so
    // replaying the last render verbatim on a theme change threw away the
    // camera the rider had set. The journey branch was already guarded with
    // fit: false (R8); the routes branch was not. It also fires unprompted —
    // theme.js flips at sunrise/sunset on its own.
    await openMap(page, { theme: 'dark' });
    await renderLine(page, '100');

    const detail = [-34.9055, -56.187];
    await setView(page, detail, 17);
    const before = await page.evaluate(() => ({
        zoom: window.__mvdMap.getZoom(),
        lat: window.__mvdMap.getCenter().lat,
        lng: window.__mvdMap.getCenter().lng,
        sections: window.__mvdGetRenderState().sections,
        theme: window.__mvdGetRenderState().theme,
    }));
    expect(before.sections).toBeGreaterThan(0);

    await page.locator('#themeToggle').click();
    await page.waitForFunction(() => window.__mvdGetRenderState().theme === 'light');

    const after = await page.evaluate(() => ({
        zoom: window.__mvdMap.getZoom(),
        lat: window.__mvdMap.getCenter().lat,
        lng: window.__mvdMap.getCenter().lng,
        sections: window.__mvdGetRenderState().sections,
    }));
    expect(after.zoom, 'theme flip moved the zoom').toBe(before.zoom);
    expect(after.lat, 'theme flip moved the centre').toBeCloseTo(before.lat, 6);
    expect(after.lng, 'theme flip moved the centre').toBeCloseTo(before.lng, 6);
    // The recolour itself still happened, so this is not passing by not rendering.
    expect(after.sections).toBe(before.sections);
});

test('hovering a line does not lift its joints above the strands', async ({ page }) => {
    // setLineHighlight brought every layer of the line to the front, joints
    // included, and the off-branch restores weight and opacity but not depth —
    // so one hover left that line's connectors painted over every strand until
    // the next full re-render: the coloured knot renderRouteJoints' bringToBack()
    // exists to prevent (user report at 26 de Marzo y Miguel Barreiro).
    await openMap(page, { theme: 'dark' });
    await renderStopRoutes(page, 2061); // Artigas → Ellauri corner, many joints
    await setView(page, [-34.92505, -56.16125], 18);

    const jointsStayUnder = () =>
        page.evaluate(() => {
            const order = window.__mvdGetDrawOrder();
            const lastJoint = order.lastIndexOf('joint');
            const firstStrand = order.indexOf('strand');
            return {
                joints: order.filter((k) => k === 'joint').length,
                strands: order.filter((k) => k === 'strand').length,
                ok: lastJoint < firstStrand,
            };
        });

    const before = await jointsStayUnder();
    // Guard against a vacuous pass: the hook must actually see both kinds.
    expect(before.joints).toBeGreaterThan(0);
    expect(before.strands).toBeGreaterThan(0);
    expect(before.ok, 'joints already out of order before hovering').toBe(true);

    // Hover one strand and leave again. The events are fired on the layer
    // rather than aimed with the mouse so the highlight provably runs (a
    // pixel-hunting mouse move that misses would make this test vacuous) — and
    // the returned weights are the proof: they are what setLineHighlight writes.
    const highlight = await page.evaluate(() => {
        let strand = null;
        window.__mvdMap.eachLayer((l) => {
            if (l._bundleSlot && !strand) strand = l;
        });
        if (!strand) return null;
        const base = strand.options.weight;
        strand.fire('mouseover');
        const hovered = strand.options.weight;
        strand.fire('mouseout');
        return { base, hovered, restored: strand.options.weight };
    });
    expect(highlight, 'no strand layer to hover').not.toBeNull();
    expect(highlight.hovered, 'mouseover did not highlight').toBeGreaterThan(highlight.base);
    expect(highlight.restored).toBe(highlight.base);

    const after = await jointsStayUnder();
    expect(after.joints).toBe(before.joints);
    expect(after.strands).toBe(before.strands);
    expect(after.ok, 'a joint is painted above a strand after hovering').toBe(true);
});

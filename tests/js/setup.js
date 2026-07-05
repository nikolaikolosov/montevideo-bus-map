// Minimal Leaflet stub: offsetline.js subclasses L.Polyline and creates points
// via L.point at import time. Only the surface actually used by the code under
// test is stubbed.
globalThis.L = {
    point: (x, y) => ({ x, y }),
    Polyline: { extend: (proto) => proto },
};

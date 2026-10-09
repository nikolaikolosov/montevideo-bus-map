# Line color palette — metrics report

Generated: 2026-10-09 · mode: regenerate-all · lines: 138 (new: 138) · candidates: 480

Method: OKLab candidate palette (hue×ring grid, sRGB-gamut and ≥3:1
contrast vs theme basemap proxy #0f172a / #f1f5f9), greedy max-min-ΔE
assignment over the stop co-location conflict graph + iterated local
search (fixed seed), with the CI gate floors as hard constraints.
ΔE = Euclidean OKLab on the shipped hex. Estimate class: measured on
committed data.

| Metric | dark | light |
|---|---|---|
| min in-clique ΔE | 0.0536 (stop 4925: L15 vs L26) | 0.0503 (stop 6987: 112 vs 456) |
| min ΔE, stops with 2 lines (target 0.2) | 0.1755 (147 vs 148) | 0.1691 (149 vs 522) |
| min ΔE, stops with 3–5 lines (target 0.12) | 0.1042 (192 vs 405) | 0.1007 (143 vs 145) |
| min ΔE, stops with 6–10 lines (target 0.08) | 0.0713 (163 vs D1) | 0.0681 (145 vs 329) |
| min ΔE, stops with 11+ lines (target 0.06) | 0.0536 (L15 vs L26) | 0.0503 (112 vs 456) |
| min in-clique ΔE, deuteranopia (report-only) | 0.0014 (stop 6987: 21 vs D5) | 0.0020 (stop 4756: 113 vs D1) |
| min in-clique ΔE, protanopia (report-only) | 0.0033 (stop 3010: 111 vs 526) | 0.0015 (stop 4909: 79 vs 124 Sd) |

CVD rows are informational (no gate) per brainstorm-004: a 41-line
clique cannot be made fully dichromacy-safe by color alone; line
number labels and chips remain the non-color channel.

"""Unit tests for the data pipeline: GTFS parsing, v2 assembly, contract validation.

No network access: the GTFS feed is an in-memory zip fixture.
"""

import io
import json
import os
import sys
import zipfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fetch_api_data import (  # noqa: E402
    MIN_RETAINED_SHARE,
    FetchError,
    _coerce_code,
    build_routes_collection,
    build_stops_collection,
    build_street_lookup,
    compact_coords,
    parse_gtfs,
    save_all,
    simplify_dp,
    validate_against_disk,
    validate_cross,
    validate_routes_collection,
    validate_stops_collection,
)

GENERATED_AT = "2026-06-27T11:36:00-03:00"

# --- GTFS fixture ---------------------------------------------------------------

GTFS_FILES = {
    "routes.txt": (
        "route_id,route_short_name,route_long_name\n"
        "R1,100,Centro - Villa Farre\n"
        "R2,405,Centro - Cerro\n"
    ),
    "trips.txt": (
        "route_id,trip_id,shape_id,trip_headsign\n"
        "R1,T1,S1,Villa Farre\n"
        "R1,T1b,S1,Villa Farre\n"  # same shape -> T1 stays representative
        "R2,T2,S2,Cerro\n"
    ),
    "stops.txt": (
        "stop_id,stop_code,stop_name,stop_lat,stop_lon\n"
        "ST1,1001,18 de Julio y Ejido,-34.90551,-56.18624\n"
        "ST2,1002,18 de Julio y Yaguaron,-34.90583,-56.18937\n"
        "ST3,,Sin Codigo,-34.90600,-56.19000\n"
        "ST4,1004,Huerfana,-91.0,-56.19\n"  # bad lat -> parsed, later caught by bbox
    ),
    "stop_times.txt": (
        "trip_id,stop_sequence,stop_id\n"
        "T1,1,ST1\n"
        "T1,2,ST2\n"
        "T2,5,ST2\n"
        "T2,9,ST3\n"
        "T2,12,STMISSING\n"  # no stops.txt row -> dropped with a counter
    ),
    "shapes.txt": (
        "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
        "S1,-34.90551,-56.18624,1\n"
        "S1,-34.90567,-56.18780,2\n"
        "S1,-34.90583,-56.18937,3\n"
        "S2,-34.90583,-56.18937,1\n"
        "S2,-34.90600,-56.19000,2\n"
    ),
}


def gtfs_zip(files=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in (files or GTFS_FILES).items():
            zf.writestr(name, content)
    return buf.getvalue()


@pytest.fixture()
def parsed():
    return parse_gtfs(gtfs_zip())


# --- parse_gtfs ------------------------------------------------------------------


def test_parse_gtfs_builds_one_route_feature_per_shape(parsed):
    routes_features, _, _ = parsed
    by_variant = {f["properties"]["COD_VARIAN"]: f for f in routes_features}
    assert set(by_variant) == {"S1", "S2"}
    s1 = by_variant["S1"]
    assert s1["properties"]["DESC_LINEA"] == "100"
    assert s1["properties"]["DESC_VARIA"] == "Villa Farre"
    assert s1["geometry"]["coordinates"][0] == [-56.18624, -34.90551]


def test_parse_gtfs_stop_occurrences_keep_sequence_and_line(parsed):
    _, occurrences, _ = parsed
    s2 = [o for o in occurrences if o["shape_id"] == "S2"]
    assert [(o["stop_id"], o["ordinal"]) for o in s2] == [
        ("ST2", 5),
        ("ST3", 9),
        ("STMISSING", 12),
    ]
    assert all(o["line"] == "405" for o in s2)


def test_parse_gtfs_missing_required_file_fails_loudly():
    files = {k: v for k, v in GTFS_FILES.items() if k != "shapes.txt"}
    with pytest.raises(FetchError, match="missing shapes.txt"):
        parse_gtfs(gtfs_zip(files))


def test_coerce_code():
    assert _coerce_code("1001") == 1001
    assert _coerce_code(" 42 ") == 42
    assert _coerce_code("ST1") == "ST1"
    assert _coerce_code(None) is None


# --- geometry helpers --------------------------------------------------------------


def test_simplify_dp_removes_collinear_points_keeps_corners():
    line = [[0.0, 0.0], [0.001, 0.0], [0.002, 0.0], [0.002, 0.002]]
    out = simplify_dp(line, 0.00001)
    assert out == [[0.0, 0.0], [0.002, 0.0], [0.002, 0.002]]


def test_compact_coords_quantizes_and_dedupes():
    coords = [
        [-56.20246759, -34.90925391],
        [-56.20246761, -34.90925392],  # same point after 5-decimal rounding
        [-56.20309641, -34.90909525],
    ]
    out = compact_coords(coords)
    assert out == [[-56.20247, -34.90925], [-56.2031, -34.9091]]


# --- v2 assembly -----------------------------------------------------------------


def test_build_stops_collection_normalizes(parsed):
    _, occurrences, meta = parsed
    street_lookup = build_street_lookup(
        [{"busstopId": 1001, "street1": "18 DE JULIO", "street2": "EJIDO"}]
    )
    col = build_stops_collection(occurrences, meta, street_lookup, GENERATED_AT)

    codes = [f["properties"]["COD_UBIC_P"] for f in col["features"]]
    assert sorted(codes, key=str) == codes  # deterministic order
    # ST3 has no stop_code and a non-numeric stop_id. It used to be emitted as the
    # string "ST3", which validate_stops_collection rejects outright, so a single
    # such row upstream blocked the whole update; it now gets a stable negative
    # surrogate and keeps its place in the pattern.
    assert all(isinstance(c, int) for c in codes)
    assert {c for c in codes if c > 0} == {1001, 1002}
    surrogate = next(c for c in codes if c < 0)

    by_code = {f["properties"]["COD_UBIC_P"]: f for f in col["features"]}
    assert by_code[1001]["properties"]["CALLE"] == "18 DE JULIO"  # enriched
    assert by_code[1002]["properties"]["CALLE"] == "18 de Julio y Yaguaron"  # GTFS fallback

    assert col["patterns"]["S1"] == {"linea": "100", "paradas": [[1001, 1], [1002, 2]]}
    # STMISSING dropped; ordinals stay strictly increasing with a gap
    assert col["patterns"]["S2"]["paradas"] == [[1002, 5], [surrogate, 9]]


def test_build_stops_collection_output_passes_its_own_validator(parsed):
    """The producer must not be able to emit what the validator rejects.

    Nothing used to check the builder's output against the contract, which is how
    the string COD_UBIC_P survived: the validator tests ran on hand-built
    fixtures, never on what build_stops_collection actually produces.
    """
    _, occurrences, meta = parsed
    col = build_stops_collection(occurrences, meta, {}, GENERATED_AT)
    # The floors are sized for the real network, so check the per-feature rules
    # rather than the volume: every COD_UBIC_P an int, unique, ordinals rising.
    codes = [f["properties"]["COD_UBIC_P"] for f in col["features"]]
    assert all(isinstance(c, int) for c in codes)
    assert len(set(codes)) == len(codes)
    for pattern in col["patterns"].values():
        ordinals = [o for _, o in pattern["paradas"]]
        assert ordinals == sorted(ordinals)
        assert all(isinstance(c, int) for c, _ in pattern["paradas"])
        assert {c for c, _ in pattern["paradas"]} <= set(codes)


def test_surrogate_codes_are_stable_across_runs(parsed):
    """Derived from the id, not from a counter — a new codeless stop upstream
    must not renumber the existing ones (churned diffs, dead deep links)."""
    def negatives(col):
        return sorted(c for f in col["features"] if (c := f["properties"]["COD_UBIC_P"]) < 0)

    _, occurrences, meta = parsed
    first = build_stops_collection(occurrences, meta, {}, GENERATED_AT)
    second = build_stops_collection(occurrences, meta, {}, GENERATED_AT)
    assert negatives(first) == negatives(second)
    assert len(negatives(first)) == 1  # only ST3 in the fixture


def test_build_routes_collection_sorted_and_versioned(parsed):
    routes_features, _, _ = parsed
    col = build_routes_collection(routes_features, GENERATED_AT)
    assert col["format_version"] == 2
    assert col["generated_at"] == GENERATED_AT
    lineas = [f["properties"]["DESC_LINEA"] for f in col["features"]]
    assert lineas == sorted(lineas)


# --- contract validation ------------------------------------------------------------


def good_collections():
    routes = {
        "type": "FeatureCollection",
        "format_version": 2,
        "generated_at": GENERATED_AT,
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-56.186, -34.905], [-56.189, -34.906]],
                },
                "properties": {"COD_VARIAN": f"S{i}", "DESC_LINEA": "100", "DESC_VARIA": "x"},
            }
            for i in range(150)
        ],
    }
    stops = {
        "type": "FeatureCollection",
        "format_version": 2,
        "generated_at": GENERATED_AT,
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-56.186, -34.905]},
                "properties": {"COD_UBIC_P": i, "CALLE": "A", "ESQUINA": "B"},
            }
            for i in range(1200)
        ],
        "patterns": {
            f"S{i}": {"linea": "100", "paradas": [[i, 1], [i + 1, 4]]} for i in range(150)
        },
    }
    return routes, stops


def test_validators_accept_good_data():
    routes, stops = good_collections()
    validate_routes_collection(routes)
    validate_stops_collection(stops)
    validate_cross(routes, stops)


@pytest.mark.parametrize(
    "mutate,message",
    [
        (lambda r, s: r.pop("format_version"), "format_version"),
        (lambda r, s: r["features"][0]["properties"].pop("DESC_LINEA"), "DESC_LINEA"),
        (
            lambda r, s: r["features"][0]["geometry"]["coordinates"].__setitem__(
                0, [56.186, -34.905]
            ),
            "bbox",
        ),
        (lambda r, s: r.__setitem__("features", r["features"][:50]), "features"),
    ],
)
def test_routes_validator_rejects(mutate, message):
    routes, stops = good_collections()
    mutate(routes, stops)
    with pytest.raises(FetchError, match=message):
        validate_routes_collection(routes)


@pytest.mark.parametrize(
    "mutate,message",
    [
        (
            lambda s: s["features"][0]["properties"].__setitem__("COD_UBIC_P", "1001"),
            "not int",
        ),
        (
            lambda s: s["features"].__setitem__(1, s["features"][0]),
            "duplicate COD_UBIC_P",
        ),
        (
            lambda s: s["patterns"]["S0"].__setitem__("paradas", [[0, 5], [1, 5]]),
            "strictly increasing",
        ),
        (
            lambda s: s["patterns"]["S0"]["paradas"].__setitem__(0, [999999, 1]),
            "not in features",
        ),
        (lambda s: s.__setitem__("patterns", {}), "patterns missing"),
        (lambda s: s.__setitem__("generated_at", "yesterday"), "ISO-8601"),
    ],
)
def test_stops_validator_rejects(mutate, message):
    _, stops = good_collections()
    mutate(stops)
    with pytest.raises(FetchError, match=message):
        validate_stops_collection(stops)


def test_cross_validator_rejects_orphan_pattern():
    routes, stops = good_collections()
    stops["patterns"]["GHOST"] = {"linea": "9", "paradas": [[0, 1]]}
    with pytest.raises(FetchError, match="no route geometry"):
        validate_cross(routes, stops)


def test_cross_validator_rejects_a_mostly_unpatterned_feed():
    """A truncated stop_times.txt: shapes intact, almost no stop patterns.

    Every pattern it does produce is consistent, so this used to pass with a
    warning and overwrite the good stops.json.
    """
    routes, stops = good_collections()
    kept = {k: stops["patterns"][k] for k in list(stops["patterns"])[:9]}  # 9 of 150
    stops["patterns"] = kept
    with pytest.raises(FetchError, match="no stop pattern"):
        validate_cross(routes, stops)


def test_cross_validator_tolerates_a_few_unpatterned_variants():
    routes, stops = good_collections()
    del stops["patterns"]["S0"]  # 1 of 150 — a data quirk, not a broken fetch
    validate_cross(routes, stops)


# --- volume regression vs the data already on disk -----------------------------


def write_datasets(tmp_path, routes, stops):
    (tmp_path / "routes.json").write_text(json.dumps(routes), encoding="utf-8")
    (tmp_path / "stops.json").write_text(json.dumps(stops), encoding="utf-8")


def test_disk_guard_rejects_a_fraction_of_the_committed_data(tmp_path, monkeypatch):
    """The realistic broken fetch: a partial feed that passes every other check."""
    monkeypatch.chdir(tmp_path)
    routes, stops = good_collections()
    write_datasets(tmp_path, routes, stops)

    truncated = {k: stops["patterns"][k] for k in list(stops["patterns"])[:60]}
    partial = dict(stops, features=stops["features"][:700], patterns=truncated)
    with pytest.raises(FetchError, match="refusing to overwrite good data"):
        validate_against_disk(routes, partial)


def test_disk_guard_allows_a_normal_sized_update(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    routes, stops = good_collections()
    write_datasets(tmp_path, routes, stops)

    # A line retired: a few stops fewer, well inside the retained share.
    shrunk = dict(stops, features=stops["features"][:1180])
    assert 1180 / len(stops["features"]) > MIN_RETAINED_SHARE
    validate_against_disk(routes, shrunk)


def test_disk_guard_can_be_overridden_explicitly(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    routes, stops = good_collections()
    write_datasets(tmp_path, routes, stops)
    partial = dict(stops, features=stops["features"][:700])
    validate_against_disk(routes, partial, allow_shrink=True)  # must not raise


def test_disk_guard_skips_when_there_is_no_baseline(tmp_path, monkeypatch):
    """First run, or a hand-deleted file: nothing trustworthy to compare with."""
    monkeypatch.chdir(tmp_path)
    routes, stops = good_collections()
    validate_against_disk(routes, stops)  # no files on disk at all

    (tmp_path / "routes.json").write_text("{ truncated", encoding="utf-8")
    (tmp_path / "stops.json").write_text("", encoding="utf-8")
    validate_against_disk(routes, stops)  # unparseable is not a baseline either


# --- atomic publish -----------------------------------------------------------


def test_save_all_publishes_both_files_and_leaves_no_temps(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    routes, stops = good_collections()
    save_all([(routes, "routes"), (stops, "stops")])

    assert json.loads((tmp_path / "routes.json").read_text(encoding="utf-8")) == routes
    assert json.loads((tmp_path / "stops.json").read_text(encoding="utf-8")) == stops
    assert sorted(p.name for p in tmp_path.iterdir()) == ["routes.json", "stops.json"]


def test_save_all_leaves_the_old_data_intact_when_a_write_fails(tmp_path, monkeypatch):
    """A failure mid-publish must not damage what is already published.

    Writing straight to the destination opened it "w" — truncating the good file
    before a single new byte existed — and published the two files as independent
    operations, so a failure between them left fresh routes against stale stops.
    """
    monkeypatch.chdir(tmp_path)
    routes, stops = good_collections()
    save_all([(routes, "routes"), (stops, "stops")])
    names = ("routes.json", "stops.json")
    before = {name: (tmp_path / name).read_text(encoding="utf-8") for name in names}

    class Unserialisable:
        pass

    doomed = dict(stops, features=[*stops["features"], Unserialisable()])
    with pytest.raises(TypeError):
        save_all([(routes, "routes"), (doomed, "stops")])

    # Neither file was replaced, and no fragment was left behind.
    for name, text in before.items():
        assert (tmp_path / name).read_text(encoding="utf-8") == text
    assert sorted(p.name for p in tmp_path.iterdir()) == ["routes.json", "stops.json"]

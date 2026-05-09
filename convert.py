import shapefile
import json
import os
from pyproj import Transformer

transformer = Transformer.from_crs(32721, 4326, always_xy=True)

def transform_coords(coords):
    if not coords: return coords
    if isinstance(coords[0], (int, float)):
        # Single coordinate pair
        return transformer.transform(coords[0], coords[1])
    elif isinstance(coords[0], (list, tuple)):
        # List of coordinates or nested lists
        return [transform_coords(c) for c in coords]
    return coords

def transform_geometry(geom):
    if geom and 'coordinates' in geom:
        geom['coordinates'] = transform_coords(geom['coordinates'])
    return geom

def shp_to_geojson_js(shp_path, js_path, var_name):
    print(f"Reading {shp_path}...")
    reader = shapefile.Reader(shp_path)
    fields = reader.fields[1:]
    field_names = [field[0] for field in fields]
    buffer = []
    
    for sr in reader.shapeRecords():
        atr = dict(zip(field_names, sr.record))
        try:
            geom = sr.shape.__geo_interface__
            geom = transform_geometry(geom)
            buffer.append(dict(type="Feature", geometry=geom, properties=atr))
        except Exception as e:
            continue
    
    geojson = dict(type="FeatureCollection", features=buffer)
    print(f"Writing {js_path}...")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write(f"const {var_name} = ")
        json.dump(geojson, f)
        f.write(";\n")
    print("Done.")

if __name__ == "__main__":
    shp_to_geojson_js("v_uptu_lsv/v_uptu_lsv.shp", "routes.js", "routesData")
    shp_to_geojson_js("v_uptu_paradas/v_uptu_paradas.shp", "stops.js", "stopsData")

import os
import json
import requests
import sys
import zipfile
import io
import csv

# Environment variables
CLIENT_ID = os.environ.get('API_CLIENT_ID')
CLIENT_SECRET = os.environ.get('API_CLIENT_SECRET')
AUTH_URL = os.environ.get('API_AUTH_URL', 'https://api.montevideo.gub.uy/auth/token')
ROUTES_URL = os.environ.get('API_ROUTES_URL')
STOPS_URL = os.environ.get('API_STOPS_URL')

def get_access_token():
    if not CLIENT_ID or not CLIENT_SECRET:
        print("Warning: API_CLIENT_ID or API_CLIENT_SECRET not set. Attempting without authentication.")
        return None

    payload = {'grant_type': 'client_credentials'}
    headers = {'Content-Type': 'application/x-www-form-urlencoded'}
    
    try:
        # Usamos solo Basic Auth, no repetimos las credenciales en el payload
        # porque Keycloak y WSO2 pueden rechazar la petición con 400/403.
        response = requests.post(AUTH_URL, auth=(CLIENT_ID, CLIENT_SECRET), data=payload, headers=headers, timeout=10)
        
        # Si falla el Basic Auth, intentamos pasarlo por el body como fallback
        if response.status_code in [400, 401, 403]:
            print(f"Basic Auth falló con {response.status_code}. Respuesta: {response.text}")
            print("Intentando autenticación vía payload (body)...")
            payload['client_id'] = CLIENT_ID
            payload['client_secret'] = CLIENT_SECRET
            response = requests.post(AUTH_URL, data=payload, headers=headers, timeout=10)
            
        response.raise_for_status()
        return response.json().get('access_token')
    except requests.exceptions.HTTPError as e:
        print(f"Error authenticating: {e}")
        if e.response is not None:
            print(f"Detalle del error de auth: {e.response.text}")
        return None
    except Exception as e:
        print(f"Error authenticating: {e}")
        return None

def process_stops_json(stops_data):
    features = []
    for stop in stops_data:
        try:
            geom = stop.get('location', {})
            if geom.get('type') != 'Point':
                continue
            
            properties = {
                'COD_UBIC_P': stop.get('busstopId'),
                'CALLE': stop.get('street1'),
                'ESQUINA': stop.get('street2')
            }
            features.append({
                'type': 'Feature',
                'geometry': geom,
                'properties': properties
            })
        except Exception as e:
            pass
            
    return {'type': 'FeatureCollection', 'features': features}

def process_gtfs_zip(zip_content):
    shapes = {} # shape_id -> list of (seq, lat, lon)
    routes = {} # route_id -> dict
    trips = {} # trip_id -> dict
    shape_to_route = {} # shape_id -> route dict
    
    with zipfile.ZipFile(io.BytesIO(zip_content)) as z:
        # Parse routes.txt
        if 'routes.txt' in z.namelist():
            with z.open('routes.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
                for row in reader:
                    routes[row['route_id']] = row
                    
        # Parse trips.txt
        if 'trips.txt' in z.namelist():
            with z.open('trips.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
                for row in reader:
                    trips[row['trip_id']] = row
                    shape_id = row.get('shape_id')
                    route_id = row.get('route_id')
                    if shape_id and route_id and shape_id not in shape_to_route:
                        shape_to_route[shape_id] = {
                            'route': routes.get(route_id, {}),
                            'headsign': row.get('trip_headsign', '')
                        }

        # Parse shapes.txt
        if 'shapes.txt' in z.namelist():
            with z.open('shapes.txt') as f:
                reader = csv.DictReader(io.TextIOWrapper(f, 'utf-8'))
                for row in reader:
                    shape_id = row['shape_id']
                    if shape_id not in shapes:
                        shapes[shape_id] = []
                    shapes[shape_id].append({
                        'seq': int(row['shape_pt_sequence']),
                        'lat': float(row['shape_pt_lat']),
                        'lon': float(row['shape_pt_lon'])
                    })

    features = []
    for shape_id, pts in shapes.items():
        pts.sort(key=lambda x: x['seq'])
        coords = [[pt['lon'], pt['lat']] for pt in pts]
        
        route_info = shape_to_route.get(shape_id, {})
        r_dict = route_info.get('route', {})
        
        desc_linea = r_dict.get('route_short_name', str(shape_id))
        desc_varia = r_dict.get('route_long_name') or route_info.get('headsign') or ''
        
        properties = {
            'COD_VARIANTE': shape_id,
            'DESC_LINEA': desc_linea,
            'DESC_VARIA': desc_varia
        }
        
        features.append({
            'type': 'Feature',
            'geometry': {
                'type': 'LineString',
                'coordinates': coords
            },
            'properties': properties
        })
        
    return {'type': 'FeatureCollection', 'features': features}

def fetch_data(url, token, is_zip=False):
    if not url: return None
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    try:
        print(f"Fetching data from {url}...")
        response = requests.get(url, headers=headers, timeout=60)
        response.raise_for_status()
        return response.content if is_zip else response.json()
    except requests.exceptions.HTTPError as e:
        print(f"Error fetching data from {url}: {e}")
        if e.response is not None:
            print(f"Detalle del error de GET: {e.response.text}")
        return None
    except Exception as e:
        print(f"Error fetching data from {url}: {e}")
        return None

def save_to_js(data, js_path, var_name):
    if not data: return
    print(f"Writing {js_path}...")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write(f"const {var_name} = ")
        json.dump(data, f)
        f.write(";\n")
        
    json_path = js_path.replace('.js', '.json')
    print(f"Writing {json_path}...")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f)

if __name__ == "__main__":
    token = get_access_token()
    
    if STOPS_URL:
        stops_raw = fetch_data(STOPS_URL, token, is_zip=False)
        if stops_raw:
            stops_geojson = process_stops_json(stops_raw)
            save_to_js(stops_geojson, "stops.js", "stopsData")
            
    if ROUTES_URL:
        routes_raw = fetch_data(ROUTES_URL, token, is_zip=True)
        if routes_raw:
            routes_geojson = process_gtfs_zip(routes_raw)
            save_to_js(routes_geojson, "routes.js", "routesData")

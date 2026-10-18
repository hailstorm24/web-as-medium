import hashlib
import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "cache"
UA = "web-as-medium-album-similarity/0.1 (hailey_coval@brown.edu)"

session = requests.Session()
session.headers["User-Agent"] = UA
_last = {}


def get_json(url, params=None, headers=None, min_interval=0.0, cache_dir=None, retries=4):
    """GET a JSON endpoint with on-disk caching, per-host throttling and 429 backoff."""
    key = hashlib.sha1((url + json.dumps(params or {}, sort_keys=True)).encode()).hexdigest()
    path = CACHE / cache_dir / f"{key}.json" if cache_dir else None
    if path and path.exists():
        return json.loads(path.read_text())

    host = url.split("/")[2]
    for attempt in range(retries):
        wait = _last.get(host, 0) + min_interval - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.time()
        r = session.get(url, params=params, headers=headers, timeout=30)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(int(r.headers.get("Retry-After", 2 ** attempt)) + 1)
            continue
        if r.status_code == 404:
            data = None
            break
        r.raise_for_status()
        data = r.json()
        break
    else:
        r.raise_for_status()

    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
    return data


def load(name):
    return json.loads((DATA / name).read_text())


def save(name, obj):
    (DATA / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False))

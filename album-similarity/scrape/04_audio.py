"""Download 30 s previews for every track -> data/audio/{rank}/{disc}-{number}.m4a|mp3.

Spotify no longer serves previews, so audio comes from the iTunes album lookup
(AOTY links each album's Apple Music id). If data/tracks.json exists (Spotify
step ran), Spotify tracks without an iTunes preview fall back to Deezer by ISRC.
Writes data/previews.json.
"""
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor

from common import DATA, get_json, load, save, session

AUDIO = DATA / "audio"


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)|\[.*?\]| - .*$", "", s)  # drop "(feat. X)", "- Remastered"
    return re.sub(r"[^a-z0-9]+", "", s)


def download(job):
    url, path = job
    if path.exists() and path.stat().st_size > 0:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    r = session.get(url, timeout=60)
    r.raise_for_status()
    path.write_bytes(r.content)


def deezer_album(a):
    """Fallback for albums missing from the US iTunes store: Deezer album search, exact artist match."""
    res = get_json("https://api.deezer.com/search/album", params={"q": f'artist:"{a["artist"]}" album:"{a["album"]}"'},
                   min_interval=0.12, cache_dir="deezer") or {}
    hits = [x for x in res.get("data", [])
            if norm(x["artist"]["name"]) == norm(a["artist"]) and norm(x["title"]) == norm(a["album"])]
    if not hits:
        return [], []
    album = max(hits, key=lambda x: x["nb_tracks"])
    tracks = get_json(f"https://api.deezer.com/album/{album['id']}/tracks", params={"limit": 200},
                      min_interval=0.12, cache_dir="deezer") or {}
    previews, jobs = [], []
    for t in tracks.get("data", []):
        if not t.get("preview"):
            continue
        path = AUDIO / str(a["rank"]) / f"{t['disk_number']}-{t['track_position']:02d}.mp3"
        previews.append({"album_rank": a["rank"], "disc": t["disk_number"], "number": t["track_position"],
                         "name": t["title"], "source": "deezer", "deezer_id": t["id"], "isrc": t.get("isrc"),
                         "duration_ms": t["duration"] * 1000, "file": str(path.relative_to(DATA))})
        jobs.append((t["preview"], path))
    return previews, jobs


def main():
    albums = load("albums.json")
    spotify_tracks = load("tracks.json") if (DATA / "tracks.json").exists() else []
    previews, jobs = [], []

    for a in albums:
        # iTunes Search API allows ~20 calls/min
        res = get_json("https://itunes.apple.com/lookup",
                       params={"id": a["apple_album_id"], "entity": "song", "country": "us", "limit": 200},
                       min_interval=3.2, cache_dir="itunes")
        songs = [s for s in (res or {}).get("results", []) if s.get("wrapperType") == "track"]
        n = 0
        for s in songs:
            if not s.get("previewUrl"):
                continue
            path = AUDIO / str(a["rank"]) / f"{s['discNumber']}-{s['trackNumber']:02d}.m4a"
            previews.append({"album_rank": a["rank"], "disc": s["discNumber"], "number": s["trackNumber"],
                             "name": s["trackName"], "source": "itunes", "itunes_id": s["trackId"],
                             "duration_ms": s.get("trackTimeMillis"), "file": str(path.relative_to(DATA))})
            jobs.append((s["previewUrl"], path))
            n += 1
        print(f"#{a['rank']:>3} {a['artist']} - {a['album']}: {n} iTunes previews")
        if n < 2:
            jobs[len(jobs) - n:] = []
            previews[len(previews) - n:] = []
            previews_dz, jobs_dz = deezer_album(a)
            previews += previews_dz
            jobs += jobs_dz
            print(f"      -> {len(previews_dz)} Deezer previews")

    # Deezer fallback for Spotify tracks iTunes didn't cover (matched by normalized title)
    have = {(p["album_rank"], norm(p["name"])) for p in previews}
    for t in spotify_tracks:
        if (t["album_rank"], norm(t["name"])) in have or not t.get("isrc"):
            continue
        dz = get_json(f"https://api.deezer.com/2.0/track/isrc:{t['isrc']}", min_interval=0.12, cache_dir="deezer")
        if not dz or "error" in dz or not dz.get("preview"):
            continue
        path = AUDIO / str(t["album_rank"]) / f"{t['disc']}-{t['number']:02d}.mp3"
        previews.append({"album_rank": t["album_rank"], "disc": t["disc"], "number": t["number"],
                         "name": t["name"], "source": "deezer", "isrc": t["isrc"],
                         "duration_ms": t["duration_ms"], "file": str(path.relative_to(DATA))})
        jobs.append((dz["preview"], path))
        print(f"  deezer: #{t['album_rank']} {t['name']}")

    with ThreadPoolExecutor(8) as pool:
        list(pool.map(download, jobs))
    save("previews.json", previews)
    print(f"{len(previews)} previews for {len({p['album_rank'] for p in previews})}/{len(albums)} albums")


if __name__ == "__main__":
    main()

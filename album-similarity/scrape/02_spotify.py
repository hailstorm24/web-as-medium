"""Fill in Spotify album/track ids and ISRCs for every album in data/albums.json.

Writes data/tracks.json: one entry per track, keyed back to its album rank.
Needs SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in album-similarity/.env.
"""
import os
import re
import unicodedata

from dotenv import load_dotenv

from common import ROOT, get_json, load, save, session

API = "https://api.spotify.com/v1"


def token():
    load_dotenv(ROOT / ".env")
    r = session.post(
        "https://accounts.spotify.com/api/token",
        data={"grant_type": "client_credentials"},
        auth=(os.environ["SPOTIFY_CLIENT_ID"], os.environ["SPOTIFY_CLIENT_SECRET"]),
        timeout=30,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def api(path, auth, **params):
    return get_json(f"{API}/{path}", params=params or None, headers=auth, min_interval=0.1, cache_dir="spotify")


def find_album(a, auth):
    """Search for albums AOTY didn't link. Exact normalized title + artist match only."""
    res = api("search", auth, q=f'album:"{a["album"]}" artist:"{a["artist"]}"', type="album", limit=10)
    for item in res["albums"]["items"]:
        if norm(item["name"]) == norm(a["album"]) and any(norm(x["name"]) == norm(a["artist"]) for x in item["artists"]):
            return item["id"]
    return None


def main():
    auth = token()
    albums = load("albums.json")
    tracks = []
    for a in albums:
        if not a["spotify_album_id"]:
            a["spotify_album_id"] = find_album(a, auth)
            a["spotify_matched_by"] = "search" if a["spotify_album_id"] else None
            if not a["spotify_album_id"]:
                print(f"  ! no Spotify match: #{a['rank']} {a['artist']} - {a['album']}")
                continue

        album = api(f"albums/{a['spotify_album_id']}", auth)
        a["spotify_name"] = album["name"]
        a["spotify_artists"] = [x["name"] for x in album["artists"]]
        a["upc"] = album.get("external_ids", {}).get("upc")
        a["label"] = album.get("label")
        a["spotify_embed"] = f"https://open.spotify.com/embed/album/{album['id']}"

        items, page = [], album["tracks"]
        while True:
            items += page["items"]
            if not page.get("next"):
                break
            page = get_json(page["next"], headers=auth, min_interval=0.1, cache_dir="spotify")

        # Simplified track objects lack ISRC; fetch full track objects one by one
        # (batch /tracks?ids= is not available to every app tier).
        for t in items:
            full = api(f"tracks/{t['id']}", auth)
            tracks.append({
                "album_rank": a["rank"],
                "disc": t["disc_number"],
                "number": t["track_number"],
                "name": t["name"],
                "artists": [x["name"] for x in t["artists"]],
                "duration_ms": t["duration_ms"],
                "explicit": t["explicit"],
                "spotify_id": t["id"],
                "spotify_uri": t["uri"],
                "spotify_embed": f"https://open.spotify.com/embed/track/{t['id']}",
                "isrc": (full or {}).get("external_ids", {}).get("isrc"),
            })
        print(f"#{a['rank']:>3} {a['artist']} - {a['album']}: {len(items)} tracks")

    save("albums.json", albums)
    save("tracks.json", tracks)
    no_isrc = sum(1 for t in tracks if not t["isrc"])
    print(f"{len(tracks)} tracks, {no_isrc} without ISRC")


if __name__ == "__main__":
    main()

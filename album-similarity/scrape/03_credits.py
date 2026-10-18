"""Credits from Genius, grouped into Spotify's credit sections:
artist / composition_lyrics / production_engineering / performers.

Finds each album on Genius via its track titles (more reliable than album
search), then reads every song's writers, producers and "custom performances"
(engineers, instruments, vocals...). One source for all albums, so credit depth
is comparable across the page. (03_credits_musicbrainz.py is the earlier
MusicBrainz version, kept for reference.) Writes data/credits.json; needs
GENIUS_ACCESS_TOKEN in album-similarity/.env.
"""
import os
import re
import unicodedata

from dotenv import load_dotenv

from common import DATA, ROOT, get_json, load, save

API = "https://api.genius.com"
SECTIONS = ("composition_lyrics", "production_engineering", "performers")

# Genius custom-performance labels are free text; classify by keyword, drop business roles.
SKIP = re.compile(r"label|publish|copyright|distribut|video|photo|art direct|artwork|(?<!sound )design|a&r|manage|"
                  r"marketing|creative direct|graphic|stylist|cover|liner|legal|clearance|coordinat|release date|"
                  r"\bat$", re.I)  # "Mastered At" / "Recorded At" name studios, not people
COMPOSITION = re.compile(r"writ|compos|lyric|arrang|orchestrat", re.I)
PRODUCTION = re.compile(r"produc|engineer|mix|master|record|programm|edit|tracking|sampl|sound design", re.I)


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)|\[.*?\]| - .*$", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def section_for(label):
    if SKIP.search(label):
        return None
    if COMPOSITION.search(label):
        return "composition_lyrics"
    if PRODUCTION.search(label):
        return "production_engineering"
    return "performers"  # instruments, vocals, choir...


def api(path, auth, **params):
    data = get_json(f"{API}/{path}", params=params or None, headers=auth, min_interval=0.25, cache_dir="genius")
    return (data or {}).get("response") or {}


EDITION = re.compile(r"\s*[\(\[][^)\]]*(deluxe|edition|expanded|bonus|extended)[^)\]]*[\)\]]", re.I)


def album_key(name, loose=False):
    """Keeps parentheticals, so "Red (Taylor's Version)" never matches "Red";
    loose=True also drops edition tags like "(Deluxe)"."""
    if loose:
        name = EDITION.sub("", name)
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", name)


def find_album(a, titles, auth):
    """Search a few track titles; return the Genius album whose name and primary artist match.
    Exact title wins; an edition-only difference ("... (Deluxe)") is the fallback."""
    loose_hit = None
    for title in titles[:6]:
        for hit in api("search", auth, q=f"{a['artist']} {title}").get("hits", []):
            song = hit["result"]
            if norm(song["primary_artist"]["name"]) not in norm(a["artist"]) and norm(a["artist"]) not in norm(song["primary_artist"]["name"]):
                continue
            album = (api(f"songs/{song['id']}", auth).get("song") or {}).get("album")
            if not album:
                continue
            if album_key(album["name"]) == album_key(a["album"]):
                return album
            if not loose_hit and album_key(album["name"], True) == album_key(a["album"], True):
                loose_hit = album
    return loose_hit


def song_credits(song, artist):
    out = {"artist": [song["primary_artist"]["name"]] + [x["name"] for x in song.get("featured_artists", [])],
           **{s: [] for s in SECTIONS}}
    for x in song.get("writer_artists", []):
        out["composition_lyrics"].append({"name": x["name"], "role": "Songwriter", "scope": "genius"})
    for x in song.get("producer_artists", []):
        out["production_engineering"].append({"name": x["name"], "role": "Producer", "scope": "genius"})
    for perf in song.get("custom_performances", []):
        if section := section_for(perf["label"]):
            for x in perf["artists"]:
                out[section].append({"name": x["name"], "role": perf["label"], "scope": "genius"})
    for s in SECTIONS:
        seen = set()
        out[s] = [c for c in out[s] if not ((c["name"], c["role"]) in seen or seen.add((c["name"], c["role"])))]
    return out


def main():
    load_dotenv(ROOT / ".env")
    auth = {"Authorization": f"Bearer {os.environ['GENIUS_ACCESS_TOKEN']}"}
    albums = {a["rank"]: a for a in load("albums.json")}
    previews = load("previews.json")
    credits = []

    for a in albums.values():
        c = {"album_rank": a["rank"], "credits_source": "genius", "genius_album": None,
             "album_credits": {}, "tracks": []}
        credits.append(c)
        titles = [p["name"] for p in previews if p["album_rank"] == a["rank"]]
        album = find_album(a, titles, auth)
        if not album:
            print(f"#{a['rank']:>3} {a['artist']} - {a['album']}: not found on Genius")
            continue
        tracks = []
        page = 1
        while page:
            res = api(f"albums/{album['id']}/tracks", auth, per_page=50, page=page)
            tracks += res.get("tracks", [])
            page = res.get("next_page")
        out_tracks = []
        for t in tracks:
            song = api(f"songs/{t['song']['id']}", auth).get("song")
            if song:
                out_tracks.append({"disc": 1, "number": t.get("number"), "name": song["title"],
                                   "genius_song": song["id"], "isrcs": [], "credits": song_credits(song, a["artist"])})
        n = sum(1 for t in out_tracks if any(t["credits"][s] for s in SECTIONS))
        c.update({"genius_album": album["id"], "genius_title": album["name"], "tracks": out_tracks})
        print(f"#{a['rank']:>3} {a['artist']} - {a['album']}: {n}/{len(out_tracks)} tracks credited"
              + ("" if album_key(album["name"]) == album_key(a["album"]) else f"  [Genius title: {album['name']}]"))

    save("credits.json", credits)
    tot = sum(len(c["tracks"]) for c in credits)
    cred = sum(1 for c in credits for t in c["tracks"] if any(t["credits"][s] for s in SECTIONS))
    print(f"{cred}/{tot} tracks have credits")


if __name__ == "__main__":
    main()

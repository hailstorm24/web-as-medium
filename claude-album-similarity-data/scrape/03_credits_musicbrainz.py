"""Credits from MusicBrainz, grouped into Spotify's credit sections.

For each album: search MB releases by title + artist, pick the official edition
whose track count matches (recordings - and their credits - are shared across
editions), then one release lookup returns every track's recording + work
relationships. Writes data/credits.json.
"""
import re
import unicodedata

from common import DATA, get_json, load, save

MB = "https://musicbrainz.org/ws/2"
INC = "recordings+artist-credits+isrcs+artist-rels+recording-level-rels+work-rels+work-level-rels"

# MusicBrainz relationship type -> (Spotify section, role label)
SECTIONS = {
    "composer": ("composition_lyrics", "Composer"),
    "lyricist": ("composition_lyrics", "Lyricist"),
    "writer": ("composition_lyrics", "Songwriter"),
    "librettist": ("composition_lyrics", "Librettist"),
    "arranger": ("composition_lyrics", "Arranger"),
    "instrument arranger": ("composition_lyrics", "Arranger"),
    "vocal arranger": ("composition_lyrics", "Vocal Arranger"),
    "orchestrator": ("composition_lyrics", "Orchestrator"),
    "producer": ("production_engineering", "Producer"),
    "engineer": ("production_engineering", "Engineer"),
    "audio": ("production_engineering", "Audio Engineer"),
    "sound": ("production_engineering", "Sound Engineer"),
    "recording": ("production_engineering", "Recording Engineer"),
    "mix": ("production_engineering", "Mixing Engineer"),
    "mastering": ("production_engineering", "Mastering Engineer"),
    "programming": ("production_engineering", "Programmer"),
    "editor": ("production_engineering", "Editor"),
    "balance": ("production_engineering", "Balance Engineer"),
    "remixer": ("production_engineering", "Remixer"),
    "instrument": ("performers", None),  # role = instrument name(s)
    "vocal": ("performers", "Vocals"),
    "performer": ("performers", "Performer"),
    "performing orchestra": ("performers", "Orchestra"),
    "conductor": ("performers", "Conductor"),
    "chorus master": ("performers", "Chorus Master"),
    "concertmaster": ("performers", "Concertmaster"),
}
MODIFIERS = {"assistant", "associate", "co", "executive", "additional", "guest", "solo", "translated"}


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)|\[.*?\]", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def mb(path, **params):
    return get_json(f"{MB}/{path}", params={**params, "fmt": "json"}, min_interval=1.1, cache_dir="musicbrainz")


def credit(rel, scope):
    section, role = SECTIONS.get(rel["type"], (None, None))
    if not section:
        return None
    attrs = rel.get("attributes", [])
    mods = [a for a in attrs if a in MODIFIERS]
    details = [a for a in attrs if a not in MODIFIERS]
    if rel["type"] == "instrument":
        role = ", ".join(details).capitalize() or "Instruments"
    elif rel["type"] == "vocal" and details:
        role = ", ".join(details).capitalize()
    elif rel["type"] == "producer" and details:  # e.g. producer + "lead vocals" = vocal producer
        role = f"{details[0].capitalize()} Producer"
    if mods:
        role = f"{' '.join(m.capitalize() for m in mods)} {role}"
    return section, {"name": rel["artist"]["name"], "mbid": rel["artist"]["id"], "role": role, "scope": scope}


def pick_release(a, n_tracks):
    q = f'release:"{a["album"]}" AND artist:"{a["artist"]}"'
    res = mb("release/", query=q, limit=25) or {}
    cands = [r for r in res.get("releases", [])
             if r.get("status") == "Official" and norm(r["title"]) == norm(a["album"])]
    paren = re.search(r"\((.*?)\)", a["album"])
    if not cands and paren:
        # "Weezer (Gold Album)" is stored in MB as "Weezer" + disambiguation "Gold Album";
        # a bare title is ambiguous, so require AOTY's release year too.
        bare = a["album"][: paren.start()].strip()
        year = a["release_date"][-4:]
        res = mb("release/", query=f'release:"{bare}" AND artist:"{a["artist"]}" AND date:[{year} TO {year}-12-31]', limit=25) or {}
        cands = [r for r in res.get("releases", []) if r.get("status") == "Official"
                 and norm(r["title"]) == norm(bare) and (r.get("date") or "").startswith(year)]
        cands.sort(key=lambda r: norm(r.get("disambiguation", "")) != norm(paren.group(1)))
    digital = lambda r: any(m.get("format") == "Digital Media" for m in r.get("media", []))
    disamb = lambda r: bool(paren) and norm(r.get("disambiguation", "")) == norm(paren.group(1))
    cands.sort(key=lambda r: (not disamb(r), abs(r.get("track-count", 0) - n_tracks), not digital(r), -r.get("score", 0)))
    # Try up to 6 editions; keep the first whose recordings actually carry credits.
    best = None
    for r in cands[:6]:
        rel = mb(f"release/{r['id']}", inc=INC)
        n_rels = sum(len(t["recording"].get("relations", [])) for m in rel.get("media", []) for t in m.get("tracks", []))
        if best is None or n_rels > best[1]:
            best = (rel, n_rels)
        if n_rels:
            break
    return best[0] if best else None


def main():
    albums = load("albums.json")
    previews = load("previews.json") if (DATA / "previews.json").exists() else []
    tracks = load("tracks.json") if (DATA / "tracks.json").exists() else []
    out = []
    for a in albums:
        n = sum(1 for t in tracks if t["album_rank"] == a["rank"]) or \
            sum(1 for p in previews if p["album_rank"] == a["rank"])
        rel = pick_release(a, n)
        if not rel:
            print(f"#{a['rank']:>3} {a['artist']} - {a['album']}: no MusicBrainz release")
            out.append({"album_rank": a["rank"], "mb_release": None, "album_credits": {}, "tracks": []})
            continue

        album_credits = {}
        for r in rel.get("relations", []):
            if "artist" in r and (c := credit(r, "release")):
                album_credits.setdefault(c[0], []).append(c[1])

        out_tracks, n_credited = [], 0
        for m in rel["media"]:
            for t in m.get("tracks", []):
                rec = t["recording"]
                sections = {"artist": [x["name"] for x in rec.get("artist-credit", [])],
                            "composition_lyrics": [], "production_engineering": [], "performers": []}
                for r in rec.get("relations", []):
                    if "artist" in r and (c := credit(r, "recording")):
                        sections[c[0]].append(c[1])
                    elif "work" in r:
                        for w in r["work"].get("relations", []):
                            if "artist" in w and (c := credit(w, "work")):
                                sections[c[0]].append(c[1])
                for k in ("composition_lyrics", "production_engineering", "performers"):
                    seen = set()  # same person+role can come from several works/edits
                    sections[k] = [c for c in sections[k] if not ((c["name"], c["role"]) in seen or seen.add((c["name"], c["role"])))]
                n_credited += any(sections[k] for k in ("composition_lyrics", "production_engineering", "performers"))
                out_tracks.append({"disc": m["position"], "number": t["position"], "name": rec["title"],
                                   "mb_recording": rec["id"], "isrcs": rec.get("isrcs", []), "credits": sections})
        out.append({"album_rank": a["rank"], "mb_release": rel["id"], "mb_title": rel["title"],
                    "album_credits": album_credits, "tracks": out_tracks})
        print(f"#{a['rank']:>3} {a['artist']} - {a['album']}: {n_credited}/{len(out_tracks)} tracks credited")

    save("credits.json", out)
    tot = sum(len(x["tracks"]) for x in out)
    cred = sum(1 for x in out for t in x["tracks"] if t["credits"]["composition_lyrics"] or t["credits"]["production_engineering"] or t["credits"]["performers"])
    print(f"{sum(1 for x in out if x['mb_release'])}/{len(out)} albums matched; {cred}/{tot} tracks have credits")


if __name__ == "__main__":
    main()

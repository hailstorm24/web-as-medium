"""Join every step into one album-keyed file for the page: album-similarity/albums.json

Track list comes from Spotify when the Spotify step has run, otherwise from the
previews. Credits are matched by (disc, track number), then by title.
"""
import json
import re
import unicodedata

from common import DATA, ROOT, load

SECTIONS = ("composition_lyrics", "production_engineering", "performers")
N_NEIGHBOURS = 10


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)|\[.*?\]| - .*$", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def exact(s):
    """Title match that keeps parentheticals but ignores case, accents and curly quotes."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9()]+", "", s)


def opt(name, default):
    return load(name) if (DATA / name).exists() else default


def main():
    albums = load("albums.json")
    spotify = opt("tracks.json", [])
    previews = opt("previews.json", [])
    credits = {c["album_rank"]: c for c in opt("credits.json", [])}
    sim = opt("similarity.json", None)

    # "similar" uses mutual proximity (hubs down-weighted); "similar_raw" is plain Logan & Salomon.
    neighbours = {"mp": {}, "raw": {}}
    if sim:
        for kind in neighbours:
            for i, r in enumerate(sim["ranks"]):
                row = sim[f"similarity_{kind}"][i]
                order = sorted((j for j in range(len(row)) if j != i), key=lambda j: -row[j])
                neighbours[kind][r] = [{"rank": sim["ranks"][j], "similarity": row[j]} for j in order[:N_NEIGHBOURS]]

    out = []
    for a in albums:
        rank = a["rank"]
        base = [t for t in spotify if t["album_rank"] == rank] or [p for p in previews if p["album_rank"] == rank]
        prev_by_pos = {(p["disc"], p["number"]): p for p in previews if p["album_rank"] == rank}
        prev_by_name = {norm(p["name"]): p for p in previews if p["album_rank"] == rank}
        c = credits.get(rank, {"tracks": [], "album_credits": {}})
        cred_by_pos = {(t["disc"], t["number"]): t for t in c["tracks"]}
        cred_exact = {exact(t["name"]): t for t in c["tracks"]}
        cred_by_name = {}
        for t in c["tracks"]:  # first wins, so "Song" beats a later "Song (Demo)"
            cred_by_name.setdefault(norm(t["name"]), t)

        tracks = []
        for t in base:
            pos, key = (t["disc"], t["number"]), norm(t["name"])
            p = prev_by_name.get(key) or prev_by_pos.get(pos)
            ct = cred_exact.get(exact(t["name"])) or cred_by_name.get(key) or (cred_by_pos.get(pos) if pos in cred_by_pos and len(c["tracks"]) == len(base) else None)
            tc = ct["credits"] if ct else {"artist": t.get("artists", [a["artist"]])}
            tracks.append({
                "disc": t["disc"], "number": t["number"], "name": t["name"],
                "duration_ms": t.get("duration_ms"),
                "spotify_id": t.get("spotify_id"), "spotify_uri": t.get("spotify_uri"),
                "spotify_embed": t.get("spotify_embed"), "isrc": t.get("isrc"),
                "preview": p["file"] if p else None,
                "credits": {
                    "artist": tc.get("artist") or t.get("artists", [a["artist"]]),
                    **{s: [{"name": x["name"], "role": x["role"]} for x in tc.get(s, [])] for s in SECTIONS},
                },
                "mb_recording": ct.get("mb_recording") if ct else None,
                "genius_song": ct.get("genius_song") if ct else None,
            })

        out.append({
            **{k: a.get(k) for k in ("rank", "artist", "album", "release_date", "genres", "score", "review_url",
                                     "aoty_url", "cover", "label", "upc", "spotify_album_id", "apple_album_id")},
            "spotify_uri": f"spotify:album:{a['spotify_album_id']}" if a.get("spotify_album_id") else None,
            "spotify_embed": f"https://open.spotify.com/embed/album/{a['spotify_album_id']}" if a.get("spotify_album_id") else None,
            "mb_release": c.get("mb_release"),
            "credits_source": c.get("credits_source", "musicbrainz") if c.get("tracks") else None,
            "album_credits": {s: [{"name": x["name"], "role": x["role"]} for x in c["album_credits"].get(s, [])]
                              for s in SECTIONS},
            "tracks": tracks,
            "similar": neighbours["mp"].get(rank, []),
            "similar_raw": neighbours["raw"].get(rank, []),
            "credits_found": any(t["credits"][s] for t in tracks for s in SECTIONS),
        })

    doc = {"source": "albumoftheyear.org - Rolling Stone highest rated, 2020s (top 100)",
           "credits_source": "Genius", "audio_source": "iTunes / Deezer 30 s previews",
           "similarity_method": sim["method"] if sim else None,
           "similarity_note": "similar / matrix.similarity: mutual proximity (Schnitzer et al. 2012) applied to the "
                              "Logan & Salomon distances to reduce hubs; similar_raw / matrix.similarity_raw: without it",
           "similarity_checks": sim["checks"] if sim else None,
           "matrix": {"ranks": sim["ranks"], "similarity": sim["similarity_mp"],
                      "similarity_raw": sim["similarity_raw"]} if sim else None,
           "albums": out}
    path = ROOT / "albums.json"
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    n_tracks = sum(len(a["tracks"]) for a in out)
    print(f"{len(out)} albums, {n_tracks} tracks -> {path.name} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

"""Parse saved AOTY list pages (data/cache/aoty_*.html) into data/albums.json.

albumoftheyear.org blocks scripted requests, so pages are saved by hand from
https://www.albumoftheyear.org/ratings/35-rolling-stone-highest-rated/2020s/{1..4}
"""
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache"
OUT = ROOT / "data" / "albums.json"
LIMIT = 100


def parse_page(path):
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
    for row in soup.select("div.albumListRow"):
        title_link = row.select_one(".albumListTitle a[itemprop=url]")
        artist, _, album = title_link.get_text(strip=True).partition(" - ")
        links = {a.get("data-track-action"): a["href"] for a in row.select(".albumListLinks a")}
        spotify = links.get("Spotify", "")
        apple = links.get("Apple Music", "")
        cover = row.select_one(".albumListCover img")
        genres = [a.get_text(strip=True) for a in row.select(".albumListGenre > a")]
        yield {
            "rank": int(row.select_one("[itemprop=position]").get_text(strip=True)),
            "artist": artist,
            "album": album,
            "release_date": row.select_one(".albumListDate").get_text(strip=True),
            "genres": genres,
            "score": int(row.select_one(".scoreValue").get_text(strip=True)),
            "review_url": (row.select_one(".scoreText a") or {}).get("href"),
            "aoty_url": "https://www.albumoftheyear.org" + title_link["href"],
            "cover": cover["src"] if cover else None,
            "spotify_album_id": m.group(1) if (m := re.search(r"album/([A-Za-z0-9]{22})", spotify)) else None,
            "apple_album_id": m.group(1) if (m := re.search(r"/(\d+)(?:\?|$)", apple)) else None,
        }


def main():
    pages = sorted(CACHE.glob("aoty_*.html"), key=lambda p: int(re.search(r"(\d+)", p.stem).group(1)))
    albums = {}
    for page in pages:
        for a in parse_page(page):
            albums[a["rank"]] = a
    albums = [albums[r] for r in sorted(albums)][:LIMIT]
    OUT.write_text(json.dumps(albums, indent=1, ensure_ascii=False))
    missing = [a["rank"] for a in albums if not a["spotify_album_id"]]
    print(f"{len(albums)} albums from {len(pages)} pages -> {OUT.relative_to(ROOT)}")
    print(f"missing Spotify link: {missing or 'none'}")
    if len(albums) < LIMIT:
        print(f"only {len(albums)}/{LIMIT}: save more pages as data/cache/aoty_N.html", file=sys.stderr)


if __name__ == "__main__":
    main()

let albums = [];      // all 100 albums from albums.json
let currentRank = 12;  // which album the side panel is showing

const sidePanel = document.querySelector(".side-panel");

// load the data, then show the first album
fetch("albums.json")
    .then(res => res.json())
    .then(data => {
        albums = data.albums;
        drawCovers();
        showAlbum(currentRank);
    });

// look up an album by its rank
function getAlbum(rank) {
    return albums.find(a => a.rank === rank);
}

// the cover urls in albums.json (albumoftheyear.org) block outside sites,
// so ask Spotify for the cover instead, and Apple if Spotify doesn't have it.
// results are saved in coverCache so each album is only looked up once.
const coverCache = {};

function getSpotifyCover(album) {
    const url = "https://open.spotify.com/album/" + album.spotify_album_id;
    return fetch("https://open.spotify.com/oembed?url=" + url)
        .then(res => res.json())
        .then(data => data.thumbnail_url);
}

function getAppleCover(album) {
    return fetch("https://itunes.apple.com/lookup?id=" + album.apple_album_id)
        .then(res => res.json())
        .then(data => data.results[0].artworkUrl100.replace("100x100", "600x600"));
}

function getCover(album) {
    if (!coverCache[album.rank]) {
        if (album.spotify_album_id) {
            coverCache[album.rank] = getSpotifyCover(album).catch(() => getAppleCover(album));
        } else {
            coverCache[album.rank] = getAppleCover(album);
        }
    }
    return coverCache[album.rank];
}

// give every <img data-cover="rank"> in the side panel its cover
function loadCovers() {
    sidePanel.querySelectorAll("img[data-cover]").forEach(img => {
        const album = getAlbum(Number(img.dataset.cover));
        img.crossOrigin = "anonymous";  // lets getAlbumColor read the pixels
        getCover(album).then(src => { img.src = src; });
    });
}

// pick a color from a loaded cover image:
// shrink it onto a canvas, group similar pixels together, and take the group
// that is the most colorful overall (a plain average usually comes out brown/grey)
function getAlbumColor(img) {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, size, size);
    const pixels = ctx.getImageData(0, 0, size, size).data;  // [r, g, b, a, r, g, b, a, ...]

    const groups = {};
    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);

        // colorful, bright pixels count more; greys and near-blacks count for almost nothing
        const saturation = max === 0 ? 0 : (max - min) / max;
        const weight = saturation * (max / 255);

        // similar colors share a group (each channel rounded down to steps of 32)
        const key = (r >> 5) + "," + (g >> 5) + "," + (b >> 5);
        if (!groups[key]) {
            groups[key] = { weight: 0, r: 0, g: 0, b: 0, count: 0 };
        }
        groups[key].weight += weight;
        groups[key].r += r;
        groups[key].g += g;
        groups[key].b += b;
        groups[key].count += 1;
    }

    const best = Object.values(groups).sort((a, b) => b.weight - a.weight)[0];
    if (best.weight < 1) {
        return null;  // black & white cover: keep the default color
    }

    let r = best.r / best.count;
    let g = best.g / best.count;
    let b = best.b / best.count;

    // brighten dark colors so the frame shows up on the black background
    const scale = Math.max(1, 200 / Math.max(r, g, b));
    r = Math.min(255, Math.round(r * scale));
    g = Math.min(255, Math.round(g * scale));
    b = Math.min(255, Math.round(b * scale));

    return `rgb(${r}, ${g}, ${b})`;
}

// the credit categories in albums.json, and how to label them
const creditCategories = {
    composition_lyrics: "Writing & Composition",
    production_engineering: "Production & Engineering",
    performers: "Performers"
};

// credits are stored per track, so combine them for the whole album into one list:
// one entry per person, with every category they appear in, their roles and how many tracks they're on
function getAlbumCredits(album) {
    const credits = {};

    album.tracks.forEach(track => {
        Object.keys(creditCategories).forEach(category => {
            track.credits[category].forEach(credit => {
                if (!credits[credit.name]) {
                    credits[credit.name] = { name: credit.name, categories: new Set(), roles: new Set(), tracks: new Set() };
                }
                credits[credit.name].categories.add(category);
                credits[credit.name].roles.add(credit.role);
                credits[credit.name].tracks.add(track.disc + "-" + track.number);
            });
        });
    });

    // people on the most tracks first
    return Object.values(credits).sort((a, b) => b.tracks.size - a.tracks.size);
}

function creditsList(album) {
    const items = getAlbumCredits(album).map(c => {
        // in the same order as creditCategories, so each combination always reads the same
        // and CSS can color it with an exact match, e.g. [data-category="composition_lyrics performers"]
        const categories = Object.keys(creditCategories).filter(cat => c.categories.has(cat));
        return `
            <li class="credit" data-category="${categories.join(" ")}">
                <span class="credit-name">${c.name}</span>
                <span class="credit-details">
                    <span class="credit-details-inner">
                        <span class="credit-roles">${[...c.roles].join(", ")}</span>
                        <span class="credit-tracks">${c.tracks.size === album.tracks.length ? "all tracks" : c.tracks.size + " of " + album.tracks.length + " tracks"}</span>
                        <span class="credit-category">${categories.map(cat => creditCategories[cat]).join(" · ")}</span>
                    </span>
                </span>
            </li>
        `;
    }).join("");

    return `<ul class="credits-list">${items}</ul>`;
}

// clicking a credit tile opens its details (and closes any other open one); clicking it again closes it.
// listening on the side panel, since its contents get replaced for every album
sidePanel.addEventListener("click", event => {
    const tile = event.target.closest(".credit");
    if (!tile) {
        return;
    }
    sidePanel.querySelectorAll(".credit.open").forEach(open => {
        if (open !== tile) {
            open.classList.remove("open");
        }
    });
    tile.classList.toggle("open");
});

// where clicking the cover goes: the album on Spotify,
// or Apple Music for the few albums without a Spotify id
function getListenUrl(album) {
    if (album.spotify_album_id) {
        return "https://open.spotify.com/album/" + album.spotify_album_id;
    }
    return "https://music.apple.com/album/" + album.apple_album_id;
}

// fill the side panel with one album's details + its similar albums
function showAlbum(rank) {
    currentRank = rank;
    const album = getAlbum(rank);
    highlightCover(rank);

    sidePanel.innerHTML = `
        <div class="album-info">
            <a href="${getListenUrl(album)}" target="_blank">
                <img class="cover" data-cover="${album.rank}" alt="${album.album} cover">
            </a>
            <h2>${album.album}</h2>
            <p class="artist">${album.artist}</p>
        </div>
        ${creditsList(album)}
    `;

    // once the cover has loaded, color the main panel from the artwork.
    // set on the root so everything using --frame-color picks it up
    const cover = sidePanel.querySelector(".cover");
    cover.addEventListener("load", () => {
        const color = getAlbumColor(cover);
        if (color) {
            document.documentElement.style.setProperty("--frame-color", color);
        } else {
            document.documentElement.style.removeProperty("--frame-color");  // back to the default
        }
    });

    // spin the cover while it's hovered. when the mouse leaves, let it
    // finish the turn it's on so it stops upright instead of tilted
    cover.addEventListener("mouseenter", () => cover.classList.add("spinning"));
    cover.addEventListener("animationiteration", () => {
        if (!cover.matches(":hover")) {
            cover.classList.remove("spinning");
        }
    });

    loadCovers();
}
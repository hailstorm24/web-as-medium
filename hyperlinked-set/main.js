let albums = [];      // all 100 albums from albums.json
let similarityMatrix = null;  // how alike every pair of albums sounds, from albums.json
let currentRank = 12;  // which album the side panel is showing
let currentPerson = null;  // whose credit tile is open, if anyone's
let hoveredPerson = null;  // whose chord the mouse is on, if anyone's
let hoveredRank = null;  // which album's cover the mouse is on, if any
let showingAll = false;  // has the panel closed with nothing picked since? the selection comes back when it reopens

const page = document.querySelector(".page");
const sidePanel = document.querySelector(".side-panel");
const panelToggle = document.querySelector(".panel-toggle");

// the page's grid stays the same, so the record doesn't move when the panel closes
function setPanelClosed(closed) {
    page.classList.toggle("panel-closed", closed);
    panelToggle.setAttribute("aria-expanded", !closed);
    panelToggle.setAttribute("aria-label", closed ? "Open side panel" : "Close side panel");
    showingAll = closed;
    showSelection();
}

panelToggle.addEventListener("click", () => setPanelClosed(!page.classList.contains("panel-closed")));

// load the data, then show the first album
fetch("albums.json")
    .then(res => res.json())
    .then(data => {
        albums = data.albums;
        similarityMatrix = data.matrix;
        drawCovers();
        showAlbum(currentRank);
    });

// look up an album by its rank
function getAlbum(rank) {
    return albums.find(a => a.rank === rank);
}

// how alike two albums sound, from 0 to 1
function getSimilarity(rankA, rankB) {
    const { ranks, similarity } = similarityMatrix;
    return similarity[ranks.indexOf(rankA)][ranks.indexOf(rankB)];
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

// read this album's color from its cover, and set it on the root as --album-[rank].
// black & white covers never get one, so they fall back to white wherever it's used
function loadAlbumColor(album, src) {
    const img = new Image();
    img.crossOrigin = "anonymous";  // lets getAlbumColor read the pixels
    img.addEventListener("load", () => {
        const color = getAlbumColor(img);
        if (color) {
            document.documentElement.style.setProperty("--album-" + album.rank, color);
        }
    });
    img.src = src;
}

// the credit categories in albums.json, and how to label them
const creditCategories = {
    composition_lyrics: "Writing & Composition",
    production_engineering: "Production & Engineering",
    performers: "Performers"
};

// every color a person can be on an album, in the order they're grouped around the ring.
// each one is a css variable with the same name in style.css, shared by the tiles and the chords
const personColors = ["artist", ...Object.keys(creditCategories), "multiple"];

// credits are stored per track, so combine them for the whole album:
// one entry per person, with the tracks they're on in each category and their roles
function getAlbumPeople(album) {
    const people = {};

    album.tracks.forEach(track => {
        ["artist", ...Object.keys(creditCategories)].forEach(category => {
            track.credits[category].forEach(credit => {
                const name = credit.name || credit;  // artists are plain names, the others are { name, role }
                if (!people[name]) {
                    people[name] = { name, tracks: {}, roles: new Set() };
                }
                if (!people[name].tracks[category]) {
                    people[name].tracks[category] = new Set();
                }
                people[name].tracks[category].add(track.disc + "-" + track.number);
                if (credit.role) {
                    people[name].roles.add(credit.role);
                }
            });
        });
    });

    return Object.values(people);
}

// one color for this person on this album, so their tile and their chords always match.
// by album: --album-[rank], set by loadAlbumColor. by connection type: the css variables in personColors
const colorByAlbum = true;

function getPersonColor(person, rank) {
    if (colorByAlbum) {
        return "album-" + rank;
    }
    if (person.tracks.artist) {
        return "artist";
    }
    const categories = Object.keys(creditCategories).filter(category => person.tracks[category]);
    return categories.length === 1 ? categories[0] : "multiple";
}

// the people who get a tile: everyone with a credit, not just an artist name.
// adds which categories they're in and every track they're on, with the most tracks first
function getAlbumCredits(album) {
    return getAlbumPeople(album)
        .map(person => {
            const categories = Object.keys(creditCategories).filter(category => person.tracks[category]);
            const allTracks = new Set(categories.flatMap(category => [...person.tracks[category]]));
            return { ...person, categories, allTracks };
        })
        .filter(credit => credit.categories.length > 0)
        .sort((a, b) => b.allTracks.size - a.allTracks.size);
}

function creditsList(album) {
    const items = getAlbumCredits(album).map(c => `
        <li class="credit" style="--c: var(--${getPersonColor(c, album.rank)}, white)">
            <span class="credit-name">${c.name}</span>
            <span class="credit-details">
                <span class="credit-details-inner">
                    <span class="credit-roles">${[...c.roles].join(", ")}</span>
                    <span class="credit-tracks">${c.allTracks.size === album.tracks.length ? "all tracks" : c.allTracks.size + " of " + album.tracks.length + " tracks"}</span>
                    <span class="credit-category">${c.categories.map(cat => creditCategories[cat]).join(" · ")}</span>
                </span>
            </span>
        </li>
    `).join("");

    return `<ul class="credits-list">${items}</ul>`;
}

function tileName(tile) {
    return tile.querySelector(".credit-name").textContent;
}

// selects this person, or goes back to the album if they're already selected.
// showSelection opens their tile and closes any other
function selectPerson(name) {
    currentPerson = name === currentPerson && !showingAll ? null : name;
    showingAll = false;
    showSelection();
}

// shows this person's chords on the ring without selecting them. null goes back to the selection
function previewPerson(name) {
    if (name !== hoveredPerson) {
        hoveredPerson = name;
        showSelection();
    }
}

// shows this album's chords on the ring without selecting it. null goes back to the selection
function previewAlbum(rank) {
    hoveredRank = rank;
    showSelection();
}

// listening on the side panel, since its contents get replaced for every album
sidePanel.addEventListener("click", event => {
    const tile = event.target.closest(".credit");
    if (tile) {
        selectPerson(tileName(tile));
    }
});

// where an album can be listened to. color fills the listen button on hover,
// and icon is what goes inside its svg, drawn on a 24 x 24 grid
const listenServices = {
    spotify: {
        name: "Spotify",
        color: "#1DB954",
        icon: `<path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>`,
        url: album => "https://open.spotify.com/album/" + album.spotify_album_id
    },
    apple: {
        name: "Apple Music",
        color: "#FA243C",
        icon: `<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>`,
        url: album => "https://music.apple.com/album/" + album.apple_album_id
    }
};

// Spotify, or Apple Music for the few albums without a Spotify id
function getListenService(album) {
    return album.spotify_album_id ? listenServices.spotify : listenServices.apple;
}

function getListenUrl(album) {
    return getListenService(album).url(album);
}

function listenButton(album) {
    const service = getListenService(album);
    return `
        <a class="listen-button" href="${getListenUrl(album)}" target="_blank"
            style="--c: ${service.color}" aria-label="Listen on ${service.name}" title="Listen on ${service.name}">
            <svg viewBox="0 0 24 24" aria-hidden="true">${service.icon}</svg>
        </a>
    `;
}

// fill the side panel with one album's details + its similar albums
function showAlbum(rank) {
    currentRank = rank;
    currentPerson = null;
    showingAll = false;
    const album = getAlbum(rank);

    sidePanel.innerHTML = `
        <div class="album-info">
            <a href="${getListenUrl(album)}" target="_blank">
                <img class="cover" data-cover="${album.rank}" alt="${album.album} cover">
            </a>
            <div class="album-title">
                <h2>${album.album}</h2>
                ${listenButton(album)}
            </div>
            <p class="artist">${album.artist}</p>
        </div>
        ${creditsList(album)}
    `;
    showSelection();

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
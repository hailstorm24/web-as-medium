let albums = [];      // all 100 albums from albums.json
let similarityMatrix = null;  // how alike every pair of albums sounds, from albums.json
let currentRank = null;  // which album the side panel is showing, if any. with no album or person, it's the about view
let currentPerson = null;  // whose view the side panel is showing instead of the album's, if anyone's
let hoveredPerson = null;  // whose chord the mouse is on, if anyone's
let hoveredRank = null;  // which album's cover (or row in a person's view) the mouse is on, if any
let showingAllAlbums = false;  // does a person's view list every album they're on, not just the ones on the ring?

const page = document.querySelector(".page");
const sidePanel = document.querySelector(".side-panel");

// load the data, then draw the ring and start on the about view
fetch("albums.json")
    .then(res => res.json())
    .then(data => {
        albums = data.albums;
        similarityMatrix = data.matrix;
        drawCovers();
        showAbout();
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

// set a css variable on the root, so everything using it picks it up. null goes back to the default
function setRootColor(name, color) {
    if (color) {
        document.documentElement.style.setProperty(name, color);
    } else {
        document.documentElement.style.removeProperty(name);
    }
}

// the cover urls in albums.json (albumoftheyear.org) block outside sites,
// so ask Spotify for the cover instead, and Apple if Spotify doesn't have it.
// results are saved in coverCache so each album is only looked up once,
// and the urls in savedCovers so reloading the page doesn't look them all up again.
const coverCache = {};
const savedCovers = JSON.parse(localStorage.getItem("covers")) || {};

function saveCover(album, src) {
    savedCovers[album.rank] = src;
    localStorage.setItem("covers", JSON.stringify(savedCovers));
    return src;
}

function getSpotifyCover(album) {
    return fetch("https://open.spotify.com/oembed?url=" + listenServices.spotify.url(album))
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
        const saved = savedCovers[album.rank];
        const lookup = album.spotify_album_id
            ? () => getSpotifyCover(album).catch(() => getAppleCover(album))
            : () => getAppleCover(album);
        coverCache[album.rank] = saved
            ? Promise.resolve(saved)
            : lookup().then(src => saveCover(album, src));
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
        groups[key] ??= { weight: 0, r: 0, g: 0, b: 0, count: 0 };
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

    const [r, g, b] = ensureContrast(best.r / best.count, best.g / best.count, best.b / best.count);
    return `rgb(${r}, ${g}, ${b})`;
}

// how bright a color looks to the eye, from 0 (black) to 1 (white). the wcag formula:
// green looks much brighter than red, and red brighter than blue, at the same value
function luminance(r, g, b) {
    const linear = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

// contrast ratio against black, from 1 (black) to 21 (white). 4.5 is the wcag minimum for text
function contrastWithBlack(r, g, b) {
    return (luminance(r, g, b) + 0.05) / 0.05;
}

const minContrast = 7;

// the smallest amount between low and high that gives [r, g, b] enough contrast once adjusted by it,
// found by halving the range each step
function smallestEnough(low, high, adjust) {
    for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        if (contrastWithBlack(...adjust(mid)) < minContrast) low = mid;
        else high = mid;
    }
    return high;
}

// brighten a color until it stands out against black.
// first scale it up, which keeps it just as colorful; if it's still too dark at full
// brightness (deep blues and purples), mix in just enough white to get there
function ensureContrast(r, g, b) {
    let color = [r, g, b];
    const scaled = amount => color.map(c => c * amount);
    const whitened = amount => color.map(c => c + (255 - c) * amount);

    if (contrastWithBlack(...color) < minContrast) {
        color = scaled(smallestEnough(1, 255 / Math.max(r, g, b, 1), scaled));
    }
    if (contrastWithBlack(...color) < minContrast) {
        color = whitened(smallestEnough(0, 1, whitened));
    }
    return color.map((c) => Math.min(255, Math.ceil(c)));
}

// read this album's color from its cover, and set it on the root as --album-[rank].
// black & white covers never get one, so they fall back to white wherever it's used
function loadAlbumColor(album, src) {
    const img = new Image();
    img.crossOrigin = "anonymous";  // lets getAlbumColor read the pixels
    img.addEventListener("load", () => {
        const color = getAlbumColor(img);
        if (color) {
            setRootColor("--album-" + album.rank, color);
        }
    });
    img.src = src;
}

// the credit categories in albums.json. artist is separate: artists are plain names, the others are { name, role }
const creditCategories = ["composition_lyrics", "production_engineering", "performers"];

// credits are stored per track, so combine them for the whole album:
// one entry per person, with the tracks they're on in each category and their roles.
// the data never changes, so each album is only combined once
const albumPeople = new Map();

function getAlbumPeople(album) {
    if (albumPeople.has(album)) {
        return albumPeople.get(album);
    }
    const people = {};
    album.tracks.forEach(track => {
        ["artist", ...creditCategories].forEach(category => {
            track.credits[category].forEach(credit => {
                const name = credit.name || credit;
                people[name] ??= { name, tracks: {}, roles: new Set() };
                people[name].tracks[category] ??= new Set();
                people[name].tracks[category].add(track.disc + "-" + track.number);
                if (credit.role) {
                    people[name].roles.add(credit.role);
                }
            });
        });
    });
    albumPeople.set(album, Object.values(people));
    return albumPeople.get(album);
}

// the number of tracks this person is on, across these categories
function trackCount(person, categories) {
    return new Set(categories.flatMap(category => [...(person.tracks[category] || [])])).size;
}

// the people who get a tile: everyone with a credit, not just an artist name, with the most tracks first.
// each tile is the album's color, --album-[rank], the same as its chords
function creditsList(album) {
    const items = getAlbumPeople(album)
        .filter(person => creditCategories.some(category => person.tracks[category]))
        .map(person => ({ name: person.name, tracks: trackCount(person, creditCategories) }))
        .sort((a, b) => b.tracks - a.tracks)
        .map(c => `
        <li class="credit" style="--c: var(--album-${album.rank}, white)">
            <span class="credit-name">${c.name}</span>
        </li>
    `).join("");

    return `<ul class="credits-list">${items}</ul>`;
}

function tileName(tile) {
    return tile.querySelector(".credit-name").textContent;
}

// selects this person and switches the side panel to them
function selectPerson(name) {
    currentPerson = name;
    showPerson(name);
    showSelection();
}

// shows this person's chords on the ring without selecting them. null goes back to the selection
function previewPerson(name) {
    if (name !== hoveredPerson) {
        hoveredPerson = name;
        showSelection();
    }
}

// shows this album's chords on the ring without selecting it, or just the selected person's chords
// on it, in a person's view. null goes back to the selection
function previewAlbum(rank) {
    if (rank !== hoveredRank) {
        hoveredRank = rank;
        showSelection();
    }
}

// listening on the side panel, since its contents get replaced for every album and person
sidePanel.addEventListener("click", event => {
    const tile = event.target.closest(".credit");
    const row = event.target.closest(".person-album");
    if (tile) {
        selectPerson(tileName(tile));
    } else if (row) {
        showAlbum(Number(row.dataset.rank));
    } else if (event.target.closest(".person-all")) {
        showingAllAlbums = !showingAllAlbums;
        showPerson(currentPerson);
    }
});

// hovering a tile shows that person's chords, the same as hovering one of their chords lights up the tile.
// hovering an album in a person's view shows their chords on it, the same as hovering its cover on the ring
sidePanel.addEventListener("mouseover", event => {
    const tile = event.target.closest(".credit");
    const row = event.target.closest(".person-album");
    previewPerson(tile ? tileName(tile) : null);
    previewAlbum(row ? Number(row.dataset.rank) : null);
});
sidePanel.addEventListener("mouseleave", () => {
    previewPerson(null);
    previewAlbum(null);
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

    // once the cover has loaded, color the main panel from the artwork
    const cover = sidePanel.querySelector(".cover");
    cover.addEventListener("load", () => setRootColor("--frame-color", getAlbumColor(cover)));

    loadCovers();
}

// the about view: nothing is selected, so the whole ring is in color, and the panel says what the diagram is
function isAboutView() {
    return currentRank === null && currentPerson === null;
}

function showAbout() {
    currentRank = null;
    currentPerson = null;
    setRootColor("--frame-color", null);

    sidePanel.innerHTML = `
        <div class="about-info">
            <h2>liner notes</h2>
            <p class="about-text">
                This project catalogs Rolling Stone's Best Albums of the 2020s, exploring how collaborations
                influence similarities across the music industry.
            </p>
            <p class="about-text">
                The chord diagram shows shared credits across albums; chords are drawn to connect each pair of
                albums that share a given contributor. Chords are colored by album and saturated by similarity;
                brighter chords connect more similar albums, computed according to methodology outlined in
                Logan &amp; Salomon's "A Music Similarity Function Based on Signal Analysis".
            </p>
            <p class="about-text">
                Use the side panel to add or remove albums from the ring. Select chords to traverse the graph
                by individual or covers to view contributors by album.
            </p>
        </div>
    `;
    sidePanel.scrollTop = 0;
    showSelection();
}

// every album this person is on, with what they did on it, by rank
function getPersonAlbums(name) {
    return albums
        .map(album => ({ album, person: getAlbumPeople(album).find(person => person.name === name) }))
        .filter(entry => entry.person)
        .sort((a, b) => a.album.rank - b.album.rank);
}

function personAlbumRow({ album, person }) {
    const roles = [...(person.tracks.artist ? ["Artist"] : []), ...person.roles];
    const tracks = trackCount(person, Object.keys(person.tracks));
    return `
        <li class="person-album" data-rank="${album.rank}"
            style="--c: var(--album-${album.rank}, white)">
            <img class="person-album-cover" data-cover="${album.rank}" alt="${album.album} cover">
            <span class="person-album-text">
                <span class="person-album-title">${album.album}</span>
                <span class="person-album-artist">${album.artist}</span>
                <span class="person-album-roles">${roles.join(", ")}</span>
                <span class="person-album-tracks">${tracks} of ${album.tracks.length}</span>
            </span>
        </li>
    `;
}

// fill the side panel with one person: the albums on the ring they're credited on, or every album
// with the toggle
function showPerson(name) {
    const allEntries = getPersonAlbums(name);
    const ringEntries = allEntries.filter(entry => onRing(entry.album.rank));
    const entries = showingAllAlbums ? allEntries : ringEntries;
    // no toggle when every one of their albums is already on the ring
    const toggle = ringEntries.length === allEntries.length ? "" : `
        <button class="person-all" type="button" aria-pressed="${showingAllAlbums}">
            ${showingAllAlbums ? "Selected only" : "Show all"}
        </button>
    `;

    sidePanel.innerHTML = `
        <div class="person-info">
            <h2>${name}</h2>
            <div class="person-count">
                <p>${entries.length} album${entries.length === 1 ? "" : "s"}</p>
                ${toggle}
            </div>
        </div>
        <ul class="person-albums">${entries.map(personAlbumRow).join("")}</ul>
    `;
    sidePanel.scrollTop = 0;
    loadCovers();
}

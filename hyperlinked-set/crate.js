// the record crate: every album as a row, like finder's list view, in a panel that slides in over the side panel.
// click a row to add it to the ring or take it off

const crateToggle = document.querySelector(".crate-toggle");
const crateCount = document.querySelector(".crate-count");
const crateAll = document.querySelector(".crate-all");
const crateList = document.querySelector(".crate-list");
const crateSorts = document.querySelectorAll(".crate-sort");

// how the crate is sorted, set by the buttons above the columns. starts oldest first
const sorters = {
    title: (a, b) => a.album.localeCompare(b.album),
    artist: (a, b) => a.artist.localeCompare(b.artist),
    date: (a, b) => new Date(a.release_date) - new Date(b.release_date),
};
let crateSort = { key: "date", descending: false };

function onRing(rank) {
    return ringRanks.includes(rank);
}

// "November 7, 2025" in albums.json, shortened to "Nov 7, 2025"
function shortDate(releaseDate) {
    return new Date(releaseDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function makeCell(className, text) {
    const cell = document.createElement("span");
    cell.className = className;
    cell.textContent = text;
    return cell;
}

// the cover, then a column each for the title, artist, and release date
function makeSleeve(album) {
    const sleeve = document.createElement("button");
    sleeve.type = "button";
    sleeve.className = "sleeve";
    sleeve.dataset.rank = album.rank;
    const img = document.createElement("img");
    img.alt = "";
    sleeve.append(
        img,
        makeCell("sleeve-title", album.album),
        makeCell("sleeve-artist", album.artist),
        makeCell("sleeve-date", shortDate(album.release_date)));
    return sleeve;
}

// covers load as they come into view, since that's up to 50 more lookups than the ring needs.
// the color loads too, so the chords are ready if it gets added
function fillSleeve(sleeve) {
    const album = getAlbum(Number(sleeve.dataset.rank));
    getCover(album).then(src => {
        sleeve.querySelector("img").src = src;
        loadAlbumColor(album, src);
    });
}

// put the sleeves in crateSort's order, and mark which button it came from
function sortCrate() {
    const order = [...albums].sort(sorters[crateSort.key]);
    if (crateSort.descending) {
        order.reverse();
    }
    const sleeves = new Map([...crateList.children].map(sleeve => [Number(sleeve.dataset.rank), sleeve]));
    crateList.append(...order.map(album => sleeves.get(album.rank)));

    crateSorts.forEach(button => {
        const on = button.dataset.key === crateSort.key;
        button.classList.toggle("on", on);
        button.dataset.dir = on ? (crateSort.descending ? "down" : "up") : "";
    });
}

// the button that's already on flips the order. a new one starts A to Z, or oldest first
crateSorts.forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.key;
    crateSort = { key, descending: key === crateSort.key && !crateSort.descending };
    sortCrate();
}));

// make the sleeves the first time the crate opens
function buildCrate() {
    const sleeves = albums.map(makeSleeve);
    crateList.append(...sleeves);
    sortCrate();

    const observer = new IntersectionObserver(entries => {
        entries.filter(entry => entry.isIntersecting).forEach(entry => {
            observer.unobserve(entry.target);
            fillSleeve(entry.target);
        });
    }, { root: crateList, rootMargin: "300px 0px" });
    sleeves.forEach(sleeve => observer.observe(sleeve));
}

// make the sleeves and the count match the ring
function updateCrate() {
    crateCount.textContent = ringRanks.length + "/" + albums.length;
    crateAll.textContent = ringRanks.length === albums.length ? "deselect all" : "select all";
    crateList.querySelectorAll(".sleeve").forEach(sleeve => {
        const on = onRing(Number(sleeve.dataset.rank));
        sleeve.classList.toggle("on", on);
        sleeve.setAttribute("aria-pressed", on);
    });
}

// the side panel moves along the ring if its album is the one leaving.
// an empty ring leaves it where it is, until an album is added
function setRing(ranks) {
    if (ranks.length && !ranks.includes(currentRank)) {
        const wasShowingAll = showingAll;
        showAlbum(ranks.find(rank => rank > currentRank) ?? ranks[0]);
        showingAll = wasShowingAll;
    }
    drawCovers(ranks);
    updateCrate();
}

// adds this album to the ring in rank order, or takes it off
function toggleAlbum(rank) {
    setRing(onRing(rank)
        ? ringRanks.filter(r => r !== rank)
        : [...ringRanks, rank].sort((a, b) => a - b));
    hoverSleeve(rank);
}

// show the chords of what's under the mouse, if it's on the ring
function hoverSleeve(rank) {
    previewAlbum(onRing(rank) ? rank : null);
}

function setCrateClosed(closed) {
    if (!albums.length || closed === page.classList.contains("crate-closed")) {
        return;  // the data hasn't loaded yet, or it's already there
    }
    if (!crateList.children.length) {
        buildCrate();
    }
    page.classList.toggle("crate-closed", closed);
    crateToggle.setAttribute("aria-expanded", !closed);
    crateToggle.setAttribute("aria-label", closed ? "Open record crate" : "Close record crate");
    if (closed) {
        previewAlbum(null);
    } else {
        updateCrate();
    }
}

crateToggle.addEventListener("click", () => setCrateClosed(!page.classList.contains("crate-closed")));

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        setCrateClosed(true);
    }
});

crateAll.addEventListener("click", () => {
    setRing(ringRanks.length === albums.length ? [] : albums.map(album => album.rank).sort((a, b) => a - b));
});

// listening on the list, so there's only one of each for all the sleeves
crateList.addEventListener("click", event => {
    const sleeve = event.target.closest(".sleeve");
    if (sleeve) {
        toggleAlbum(Number(sleeve.dataset.rank));
    }
});

crateList.addEventListener("mouseover", event => {
    const sleeve = event.target.closest(".sleeve");
    if (sleeve) {
        hoverSleeve(Number(sleeve.dataset.rank));
    }
});

crateList.addEventListener("mouseleave", () => previewAlbum(null));

crateList.addEventListener("focusin", event => {
    if (event.target.matches(".sleeve:focus-visible")) {
        hoverSleeve(Number(event.target.dataset.rank));
    }
});

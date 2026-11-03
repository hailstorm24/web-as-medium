// the record crate: every album's cover in a panel that drops over the side panel.
// click a cover to add it to the ring or take it off

const crateToggle = document.querySelector(".crate-toggle");
const crateCount = document.querySelector(".crate-count");
const crateAll = document.querySelector(".crate-all");
const crateReadout = document.querySelector(".crate-readout");
const crateList = document.querySelector(".crate-list");

function onRing(rank) {
    return ringRanks.includes(rank);
}

function makeSleeve(album) {
    const sleeve = document.createElement("button");
    sleeve.type = "button";
    sleeve.className = "sleeve";
    sleeve.dataset.rank = album.rank;
    sleeve.style.setProperty("--c", `var(--album-${album.rank}, white)`);
    sleeve.setAttribute("aria-label", album.album + ", " + album.artist);
    sleeve.append(document.createElement("img"));
    return sleeve;
}

// covers load as they come into view, since that's up to 50 more lookups than the ring needs.
// the color loads too, so the hover frame and the chords are ready if it gets added
function fillSleeve(sleeve) {
    const album = getAlbum(Number(sleeve.dataset.rank));
    getCover(album).then(src => {
        sleeve.querySelector("img").src = src;
        loadAlbumColor(album, src);
    });
}

// make the sleeves the first time the crate opens
function buildCrate() {
    const sleeves = [...albums].sort((a, b) => a.rank - b.rank).map(makeSleeve);
    crateList.append(...sleeves);

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

// show what's under the mouse: its name here, and its chords if it's on the ring
function hoverSleeve(rank) {
    const album = getAlbum(rank);
    crateReadout.textContent = album.album + " — " + album.artist;
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
        crateReadout.textContent = "";
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

crateList.addEventListener("mouseleave", () => {
    crateReadout.textContent = "";
    previewAlbum(null);
});

crateList.addEventListener("focusin", event => {
    if (event.target.matches(".sleeve:focus-visible")) {
        hoverSleeve(Number(event.target.dataset.rank));
    }
});

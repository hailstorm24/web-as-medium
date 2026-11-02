const ring = document.querySelector(".ring");
const svgNS = "http://www.w3.org/2000/svg";  // svg elements have to be made with createElementNS
const numAlbums = 50;

// which albums are on the ring, in order clockwise from the top.
// change this (or call drawCovers with a different list) to show a different set
let ringRanks = Array.from({ length: numAlbums }, (_, i) => i + 1);  // [1, 2, ..., numAlbums]

// sizes are in viewBox units: the ring's viewBox runs from -380 to 380,
// so (0, 0) is the center and 380 is the edge of the circle
const ringEdge = 380 - 6;  // leave a little gap inside the edge

// where an album sits on the ring, in degrees: spread evenly, starting at the top (-90°) and going clockwise
function ringAngle(position, count) {
    return position * 360 / count - 90;
}

// fewer albums get bigger covers: each one takes most of its share of the circle
function ringCoverSize(count) {
    return Math.min(48, 2 * Math.PI * ringEdge / count * 0.8);
}

// put the covers for these ranks around the edge of the diagram, and the chords between them
function drawCovers(ranks = ringRanks) {
    ringRanks = ranks;
    ring.querySelectorAll(".ring-cover-group").forEach(group => group.remove());  // clear the old ring
    drawChords(ranks);

    const coverSize = ringCoverSize(ranks.length);
    const coverRadius = ringEdge - coverSize / 2;  // center of each cover

    ranks.forEach((rank, i) => {
        const album = getAlbum(rank);
        const angle = ringAngle(i, ranks.length);

        // move out to the edge, then turn so the cover sits along the circle
        // (+90 so the top of each cover faces outward, like a clock face)
        const group = document.createElementNS(svgNS, "g");
        group.classList.add("ring-cover-group");
        group.setAttribute("transform", `rotate(${angle}) translate(${coverRadius}, 0) rotate(90)`);

        const image = document.createElementNS(svgNS, "image");
        image.classList.add("ring-cover");
        image.dataset.rank = album.rank;
        image.setAttribute("x", -coverSize / 2);  // centered on the group's position
        image.setAttribute("y", -coverSize / 2);
        image.setAttribute("width", coverSize);
        image.setAttribute("height", coverSize);

        // hover text with the album and artist
        const title = document.createElementNS(svgNS, "title");
        title.textContent = album.album + " — " + album.artist;
        image.append(title);

        getCover(album).then(src => image.setAttribute("href", src));

        image.addEventListener("click", () => showAlbum(album.rank));

        group.append(image);
        ring.append(group);
    });

    showSelection();
}

// make the ring and the tiles match currentRank and currentPerson.
// the album is always selected, and a person narrows it down to their chords, with the rest of the
// album's chords kept as context. a person with no chords leaves the ring as it is
function showSelection() {
    const person = hasChords(currentPerson) ? currentPerson : null;
    const inFocus = chord => person ? chord.person === person : chordTouches(chord, currentRank);

    highlightChords(chord => {
        if (inFocus(chord)) {
            return "focus";
        }
        return chordTouches(chord, currentRank) ? "context" : "background";
    });

    // the covers at both ends of the chords in focus
    const linkedRanks = new Set(drawnChords.filter(inFocus).flatMap(chord => chord.ends.map(end => end.rank)));
    ring.querySelectorAll(".ring-cover").forEach(image => {
        const rank = Number(image.dataset.rank);
        image.classList.toggle("current", rank === currentRank);
        image.classList.toggle("linked", linkedRanks.has(rank));
    });

    sidePanel.querySelectorAll(".credit").forEach(tile => {
        tile.classList.toggle("no-chords", !hasChords(tileName(tile)));
    });
}

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

        getCover(album).then(src => {
            image.setAttribute("href", src);
            loadAlbumColor(album, src);
        });

        image.addEventListener("mouseenter", () => previewAlbum(album.rank));
        image.addEventListener("mouseleave", () => previewAlbum(null));
        image.addEventListener("click", () => {
            showAlbum(album.rank);
            setPanelClosed(false);
        });

        group.append(image);
        ring.append(group);
    });

    showSelection();
}

// make the ring and the side panel match what's selected: an album, or a person in a person's view.
// the selection's chords are in focus. hovering narrows to what's hovered, with the selection's other
// chords kept as context: a person on an album, or an album in a person's view.
// a person with no chords has nothing to show, so the whole ring goes grey.
// while showingAll, nothing is selected, so every chord and cover is in color until something's hovered
function showSelection() {
    const personView = !showingAll && currentPerson;
    const noChords = hoveredPerson && !hasChords(hoveredPerson);
    const everything = showingAll && !hoveredPerson && !hoveredRank;

    const inFocus = chord => {
        if (hoveredPerson) {
            return chord.person === hoveredPerson;
        }
        if (personView) {
            return chord.person === currentPerson && (!hoveredRank || chordTouches(chord, hoveredRank));
        }
        return everything || chordTouches(chord, hoveredRank ?? currentRank);
    };
    const inContext = chord => {
        if (showingAll || noChords) {
            return false;
        }
        return personView ? chord.person === currentPerson : chordTouches(chord, currentRank);
    };

    highlightChords(chord => {
        if (inFocus(chord)) {
            return "focus";
        }
        return inContext(chord) ? "context" : "background";
    });

    // the covers at both ends of the chords in focus
    const linkedRanks = new Set(drawnChords.filter(inFocus).flatMap(chord => chord.ends.map(end => end.rank)));
    ring.querySelectorAll(".ring-cover").forEach(image => {
        const rank = Number(image.dataset.rank);
        image.classList.toggle("current", !showingAll && !personView && rank === currentRank);
        image.classList.toggle("hovered", rank === hoveredRank);  // from a row in a person's view
        image.classList.toggle("linked", linkedRanks.has(rank) || everything);  // even with no chords
    });

    sidePanel.querySelectorAll(".credit").forEach(tile => {
        const name = tileName(tile);
        tile.classList.toggle("no-chords", !hasChords(name));
        tile.classList.toggle("highlighted", name === hoveredPerson);
    });

    // in a person's view: the album hovered on the ring, or both ends of one of their chords
    sidePanel.querySelectorAll(".person-album").forEach(row => {
        const rank = Number(row.dataset.rank);
        const onChord = hoveredPerson === currentPerson && hoveredChordRanks.includes(rank);
        row.classList.toggle("highlighted", rank === hoveredRank || onChord);
    });
}

const ring = document.querySelector(".ring");
const svgNS = "http://www.w3.org/2000/svg";  // svg elements have to be made with createElementNS

// which albums are on the ring, in order clockwise from the top.
// change this (or call drawCovers with a different list) to show a different set
let ringRanks = Array.from({ length: 50 }, (_, i) => i + 1);  // [1, 2, ..., 50]

// sizes are in viewBox units: the ring's viewBox runs from -380 to 380,
// so (0, 0) is the center and 380 is the edge of the circle
const ringEdge = 380 - 6;  // leave a little gap inside the edge

// put the covers for these ranks around the edge of the diagram
function drawCovers(ranks = ringRanks) {
    ringRanks = ranks;
    ring.querySelectorAll(".ring-cover-group").forEach(group => group.remove());  // clear the old ring

    // fewer albums get bigger covers: each one takes most of its share of the circle
    const coverSize = Math.min(48, 2 * Math.PI * ringEdge / ranks.length * 0.8);
    const coverRadius = ringEdge - coverSize / 2;  // center of each cover

    ranks.forEach((rank, i) => {
        const album = getAlbum(rank);
        // spread evenly around the ring, starting at the top (-90°) and going clockwise
        const angle = i * 360 / ranks.length - 90;

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

    highlightCover(currentRank);
}

// light up the cover of the album that's in the side panel
function highlightCover(rank) {
    ring.querySelectorAll(".ring-cover").forEach(image => {
        image.classList.toggle("current", Number(image.dataset.rank) === rank);
    });
}

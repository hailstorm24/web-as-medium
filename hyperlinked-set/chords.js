// the lines inside the ring: one chord for each person credited on both albums it joins.
// each step only hands data to the next, so one can change without touching the others:
// getChords (who connects to what) -> placeChordEnds (where on the circle)
// -> drawChords (svg) -> highlightChords (how they look right now)

// sizes are in the ring's viewBox units, see diagram.js
const chordSpread = 0.42;  // how far an album's chords reach from its center, as a share of its slot
const chordGap = 1 / 30;  // the space between two people's chords, as a share of a slot

// how a chord looks in each tier, listed bottom to top: later tiers are drawn over earlier ones.
// color only ever means selected, so a selected chord always outranks an unselected one, and
// similarity only shows within a tier. saturation is how far the chord goes from its grey to its
// full color, as [least similar albums, most similar albums]. grey is a css variable.
// opacity is any css value, so the dimmer tiers can scale with --dim in style.css
const chordStyles = {
    background: { saturation: [0, 0], opacity: "calc(var(--dim) * .2)", grey: "--chord-background" },
    context: { saturation: [0.5, 0.5], opacity: "calc(var(--dim) * .4)", grey: "--chord-grey" },
    focus: { saturation: [0.5, 1], opacity: 1, grey: "--chord-grey" }
};

// everything drawn in here goes under the covers.
// chords are too thin to aim at, so each one has a wider invisible copy in hitLayer that takes the mouse
const chordLayer = document.createElementNS(svgNS, "g");
chordLayer.classList.add("chords");
const hitLayer = document.createElementNS(svgNS, "g");
hitLayer.classList.add("chord-hits");
ring.prepend(chordLayer, hitLayer);

let drawnChords = [];
let chordRadius = 0;  // set in drawChords, since it depends on the size of the covers

// find everyone on two or more of these albums, and make a chord for each pair of albums they share.
// an "end" is one person on one album, so all of that person's chords from an album share one end
function getChords(ranks) {
    const endsByPerson = {};

    ranks.forEach(rank => {
        getAlbumPeople(getAlbum(rank)).forEach(person => {
            if (!endsByPerson[person.name]) {
                endsByPerson[person.name] = [];
            }
            endsByPerson[person.name].push({
                rank,
                color: getPersonColor(person, rank),
                roles: [...person.roles]
            });
        });
    });

    const chords = [];
    Object.entries(endsByPerson).forEach(([person, ends]) => {
        ends.forEach((end, i) => {
            ends.slice(i + 1).forEach(otherEnd => {
                chords.push({
                    person,
                    ends: [end, otherEnd],
                    similarity: getSimilarity(end.rank, otherEnd.rank)
                });
            });
        });
    });
    return chords;
}

// give every end an angle. each album's ends are grouped by color, and within a color
// sorted by the direction of their chords, which keeps crossings down
function placeChordEnds(chords, ranks) {
    const slot = 2 * Math.PI / ranks.length;
    const positions = {};  // rank -> position on the ring
    const albumEnds = {};  // rank -> that album's ends
    ranks.forEach((rank, i) => {
        positions[rank] = i;
        albumEnds[rank] = new Set();
    });

    // how far clockwise the other album is from this end's album
    function addLink(end, otherEnd) {
        const distance = (positions[otherEnd.rank] - positions[end.rank] + ranks.length) % ranks.length;
        end.distances = (end.distances || []).concat(distance);
        albumEnds[end.rank].add(end);
    }
    chords.forEach(({ ends: [end, otherEnd] }) => {
        addLink(end, otherEnd);
        addLink(otherEnd, end);
    });

    const average = list => list.reduce((sum, value) => sum + value, 0) / list.length;

    ranks.forEach((rank, i) => {
        const ends = [...albumEnds[rank]].sort((a, b) =>
            personColors.indexOf(a.color) - personColors.indexOf(b.color)
            || average(b.distances) - average(a.distances));

        const step = Math.min(slot * chordGap, 2 * slot * chordSpread / ends.length);
        const center = ringAngle(i, ranks.length) * Math.PI / 180;
        const start = center - step * (ends.length - 1) / 2;
        ends.forEach((end, j) => {
            end.angle = start + j * step;
        });
    });
}

function chordPoint(end) {
    return [chordRadius * Math.cos(end.angle), chordRadius * Math.sin(end.angle)];
}

function chordColor(color, saturation, grey) {
    return `color-mix(in srgb, var(--${color}, white) ${saturation * 100}%, var(${grey}))`;
}

// a chord whose ends are different colors blends between them
function addChordGradient(chord, id) {
    const [[x1, y1], [x2, y2]] = chord.ends.map(chordPoint);
    const gradient = document.createElementNS(svgNS, "linearGradient");
    gradient.id = id;
    gradient.setAttribute("gradientUnits", "userSpaceOnUse");
    gradient.setAttribute("x1", x1);
    gradient.setAttribute("y1", y1);
    gradient.setAttribute("x2", x2);
    gradient.setAttribute("y2", y2);

    chord.stops = chord.ends.map((end, i) => {
        const stop = document.createElementNS(svgNS, "stop");
        stop.setAttribute("offset", i);
        gradient.append(stop);
        return stop;
    });

    chordLayer.append(gradient);
    chord.path.style.stroke = `url(#${id})`;
}

// draw a chord for every person shared between these albums
function drawChords(ranks) {
    // just inside the covers, even when one is scaled up by 1.25 on hover
    chordRadius = ringEdge - ringCoverSize(ranks.length) * 1.125 - 4;

    const chords = getChords(ranks);
    placeChordEnds(chords, ranks);

    chordLayer.replaceChildren();  // clear the old chords
    hitLayer.replaceChildren();
    drawnChords = chords.sort((a, b) => a.similarity - b.similarity);  // more similar pairs on top

    drawnChords.forEach((chord, i) => {
        const [[x1, y1], [x2, y2]] = chord.ends.map(chordPoint);
        const curve = `M${x1},${y1} Q0,0 ${x2},${y2}`;  // curves through the center

        chord.path = document.createElementNS(svgNS, "path");
        chord.path.classList.add("chord");
        chord.path.setAttribute("d", curve);

        if (chord.ends[0].color !== chord.ends[1].color) {
            addChordGradient(chord, "chord-gradient-" + i);
        }

        chordLayer.append(chord.path);

        // hover text with the person's name
        const title = document.createElementNS(svgNS, "title");
        title.textContent = chord.person;

        chord.hit = document.createElementNS(svgNS, "path");
        chord.hit.classList.add("chord-hit");
        chord.hit.dataset.index = i;
        chord.hit.setAttribute("d", curve);
        chord.hit.append(title);
        hitLayer.append(chord.hit);
    });
}

// the chord under the mouse
function chordAt(event) {
    return drawnChords[event.target.dataset.index];
}

// selects the person on this chord and opens the panel to their view. a chord that doesn't touch the album being shown
// moves to the higher ranked of its two albums first, since a person is always selected on an album
function clickChord(chord) {
    if (!chordTouches(chord, currentRank)) {
        showAlbum(Math.min(...chord.ends.map(end => end.rank)));
    }
    selectPerson(chord.person);
    setPanelClosed(false);
}

// listening on the layer, since its paths get replaced in every redraw
hitLayer.addEventListener("mouseover", event => previewChord(chordAt(event)));
hitLayer.addEventListener("mouseleave", () => previewChord(null));

// shows this chord's person on the ring, and remembers its albums so a person's view can light up their rows
function previewChord(chord) {
    hoveredChordRanks = chord ? chord.ends.map(end => end.rank) : [];
    hoveredPerson = null;  // so previewPerson redraws even when moving between two of the same person's chords
    previewPerson(chord ? chord.person : null);
}
hitLayer.addEventListener("click", event => clickChord(chordAt(event)));

function styleChord(chord, style) {
    const [least, most] = style.saturation;
    const saturation = least + chord.similarity * (most - least);
    if (chord.stops) {
        chord.stops.forEach((stop, i) => {
            stop.style.stopColor = chordColor(chord.ends[i].color, saturation, style.grey);
        });
    } else {
        chord.path.style.stroke = chordColor(chord.ends[0].color, saturation, style.grey);
    }
    chord.path.style.strokeOpacity = style.opacity;
}

// tierOf(chord) says which of chordStyles each chord gets
function highlightChords(tierOf) {
    Object.keys(chordStyles).forEach(tier => {
        drawnChords.filter(chord => tierOf(chord) === tier).forEach(chord => {
            styleChord(chord, chordStyles[tier]);
            chordLayer.append(chord.path);  // later tiers go on top
            hitLayer.append(chord.hit);  // and win when chords overlap
        });
    });
}

// does this chord connect to this album?
function chordTouches(chord, rank) {
    return chord.ends.some(end => end.rank === rank);
}

// is this person on any chords?
function hasChords(name) {
    return drawnChords.some(chord => chord.person === name);
}

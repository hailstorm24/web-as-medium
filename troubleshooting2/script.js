const poster = document.querySelector(".poster");
const phrase = document.querySelector(".phrase");
const counter = document.querySelector(".counter");
const nextButton = document.querySelector(".next-button");
const invertButton = document.querySelector(".invert-button");

const phrases = [
  "The web is a place.",
  "A link is a decision.",
  "Every interface has a point of view."
];

let currentPhrase = 0;

nextButton.addEventListener("click", function () {
  currentPhrase = currentPhrase + 1;
  if (currentPhrase === phrases.length) {
    currentPhrase = 0;
  }
  phrase.textContent = phrases[currentPhrase];
  counter.textContent =
    "Phrase " + (currentPhrase + 1) + " of " + phrases.length;

});

invertButton.addEventListener("click", function () {
  poster.classList.toggle("inverted");
});
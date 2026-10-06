function setRandomHexColor(elm) {
    const randomColor = Math.floor(Math.random() * 0xFFFFFF).toString(16);
    elm.style.backgroundColor = `#${randomColor.padStart(6, '0')}`;
};

function setRandomLocation(elm, width, height) {
    let vw = window.innerWidth;
    let vh = window.innerHeight;
    let x = Math.random() * (vw - width);
    let y = Math.random() * (vh - height);
    elm.style.left = x + 'px';
    elm.style.top = y + 'px';
}

function halfSpeed(elm) {
    const current = getComputedStyle(elm).getPropertyValue('--speed');
    elm.style.setProperty('--speed', parseFloat(current) / 2 + 's');
}

function splitElement(elm) {
    const newElm = elm.cloneNode(true);
    newElm.style.left = getComputedStyle(elm).getPropertyValue('left');
    newElm.style.top = getComputedStyle(elm).getPropertyValue('top');
    initialize(newElm);
    document.body.appendChild(newElm);
}

function initialize(button) {
    button.addEventListener("mouseover", function () {
        setRandomLocation(button, 100, 100);
    });
    button.addEventListener("click", function () {
        setRandomHexColor(button);
        splitElement(button);
        halfSpeed(button);
        setRandomLocation(button, 100, 100);
    });
}

document.addEventListener("DOMContentLoaded", (event) => {
    const buttons = document.querySelectorAll(".button")
    buttons.forEach(function (button) {
        initialize(button);
    });
});
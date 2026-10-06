function setRandomHexColor(elm) {
    const randomColor = Math.floor(Math.random() * 0xFFFFFF).toString(16);
    elm.style.setProperty('--color', `#${randomColor.padStart(6, '0')}`);
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    setTimeout(() => {
        toggle = newElm.querySelector('.toggle input');
        toggle.checked = false;
        setRandomHexColor(newElm);
    }, 1000);

    container = document.getElementById('button-container')
    container.appendChild(newElm);
}

function onClick(button) {
    container = document.getElementById('button-container')
    originalColor = getComputedStyle(button).getPropertyValue('--color');
    container.style.backgroundColor = `color-mix(in srgb, ${originalColor} 25%, white)`;
    toggle = button.querySelector('.toggle input');
    if (toggle.checked) {
        setTimeout(() => {
            setRandomLocation(button, 100, 100);
            splitElement(button);
        }, 200);
        setTimeout(() => {
            toggle = button.querySelector('.toggle input');
            toggle.checked = false;
            setRandomHexColor(button);
        }, 1000);
    }
}

function initialize(button) {
    button.addEventListener("mouseover", function () {
        setRandomLocation(button, 100, 100);
    });
    button.addEventListener("click", function () {
        onClick(button);
    });
}

document.addEventListener("DOMContentLoaded", (event) => {
    const buttons = document.querySelectorAll(".toggle")
    buttons.forEach(function (button) {
        initialize(button);
    });
});


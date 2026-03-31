// Shared interactive behavior for both Sloppy instances

const SVG_WIDTH = 153;
const SVG_HEIGHT = 158;
const LEFT_EYE = { cx: 47.17, cy: 60.05 };
const RIGHT_EYE = { cx: 106.17, cy: 60.05 };
const LEFT_PUPIL_DEFAULT = { dx: 8, dy: 0 };
const RIGHT_PUPIL_DEFAULT = { dx: -7, dy: 0 };
const MAX_PUPIL_OFFSET = 8;
const CROSS_PUPIL_OFFSET = 13;
const TRACKING_RADIUS = 120;

let mouseX = 0;
let mouseY = 0;

document.addEventListener("mousemove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

// ---- Pupil math ----

function toScreenCoords(svg: SVGSVGElement, svgX: number, svgY: number) {
  const rect = svg.getBoundingClientRect();
  return {
    x: rect.left + (svgX / SVG_WIDTH) * rect.width,
    y: rect.top + (svgY / SVG_HEIGHT) * rect.height,
  };
}

function calcPupilTransform(
  svg: SVGSVGElement,
  eye: { cx: number; cy: number },
  defaultOffset: { dx: number; dy: number },
  overrideX?: number,
  overrideY?: number,
): string {
  let desiredX: number, desiredY: number;

  if (overrideX !== undefined && overrideY !== undefined) {
    desiredX = overrideX;
    desiredY = overrideY;
  } else {
    const eyeScreen = toScreenCoords(svg, eye.cx, eye.cy);
    const dx = mouseX - eyeScreen.x;
    const dy = mouseY - eyeScreen.y;
    const angle = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);
    const factor = Math.min(dist / TRACKING_RADIUS, 1);
    desiredX = Math.cos(angle) * MAX_PUPIL_OFFSET * factor;
    desiredY = Math.sin(angle) * MAX_PUPIL_OFFSET * factor;
  }

  const tx = desiredX - defaultOffset.dx;
  const ty = desiredY - defaultOffset.dy;
  return `translate(${tx.toFixed(2)}, ${ty.toFixed(2)})`;
}

function checkCrossEyed(svg: SVGSVGElement): boolean {
  const leftInner = toScreenCoords(svg, 67, 40);
  const rightInner = toScreenCoords(svg, 86, 80);
  return (
    mouseX >= leftInner.x &&
    mouseX <= rightInner.x &&
    mouseY >= leftInner.y &&
    mouseY <= rightInner.y
  );
}

// ---- Track pupils for a given sloppy container ----

function updatePupilsFor(container: HTMLElement, svg: SVGSVGElement) {
  const pupils = container.querySelectorAll<SVGGElement>(".sloppy-pupil-group");
  const leftPupil = container.querySelector<SVGGElement>('[data-eye="left"]')!;
  const rightPupil = container.querySelector<SVGGElement>('[data-eye="right"]')!;

  const isCrossEyed = checkCrossEyed(svg);

  if (isCrossEyed) {
    leftPupil.setAttribute("transform", calcPupilTransform(svg, LEFT_EYE, LEFT_PUPIL_DEFAULT, CROSS_PUPIL_OFFSET, 0));
    rightPupil.setAttribute("transform", calcPupilTransform(svg, RIGHT_EYE, RIGHT_PUPIL_DEFAULT, -CROSS_PUPIL_OFFSET, 0));
    container.classList.add("cross-eyed");
    if (!container.dataset.angryHover) {
      container.classList.remove("angry");
    }
  } else {
    leftPupil.setAttribute("transform", calcPupilTransform(svg, LEFT_EYE, LEFT_PUPIL_DEFAULT));
    rightPupil.setAttribute("transform", calcPupilTransform(svg, RIGHT_EYE, RIGHT_PUPIL_DEFAULT));
    container.classList.remove("cross-eyed");
    if (!container.dataset.angryHover) {
      container.classList.remove("angry");
    }
  }
}

// ---- Elements ----

const heroSloppy = document.getElementById("sloppy-hero")!;
const heroSvg = heroSloppy.querySelector<SVGSVGElement>(".sloppy-svg")!;
const roamingSloppy = document.getElementById("sloppy-roaming")!;
const roamingSvg = roamingSloppy.querySelector<SVGSVGElement>(".sloppy-svg")!;
const heroLogo = heroSloppy.parentElement!;

// ---- rAF loop — drives both instances ----

let rafId: number;

function tick() {
  updatePupilsFor(heroSloppy, heroSvg);
  if (roamingSloppy.classList.contains("visible")) {
    updatePupilsFor(roamingSloppy, roamingSvg);
  }
  rafId = requestAnimationFrame(tick);
}

rafId = requestAnimationFrame(tick);

// ---- Scroll: show/hide roaming sloppy ----

let peekTimeout: ReturnType<typeof setTimeout> | null = null;

const observer = new IntersectionObserver(
  (entries) => {
    const entry = entries[0];
    if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
      // Hero sloppy scrolled out → show roaming after delay
      if (!dismissed && !roamingSloppy.classList.contains("visible")) {
        peekTimeout = setTimeout(() => {
          if (!dismissed) roamingSloppy.classList.add("visible");
        }, 500);
      }
    } else {
      // Hero sloppy visible → hide roaming
      if (peekTimeout) {
        clearTimeout(peekTimeout);
        peekTimeout = null;
      }
      roamingSloppy.classList.remove("visible");
    }
  },
  { threshold: 0 },
);
observer.observe(heroLogo);

// ---- Red eyes on problem cards (affects both) ----

const angryTriggers = document.querySelectorAll(".rival");

function setAngryHover(angry: boolean) {
  const targets = [heroSloppy, roamingSloppy];
  targets.forEach((el) => {
    if (angry) {
      el.dataset.angryHover = "1";
      el.classList.add("angry");
    } else {
      delete el.dataset.angryHover;
      el.classList.remove("angry");
    }
  });
}

angryTriggers.forEach((el) => {
  el.addEventListener("mouseenter", () => setAngryHover(true));
  el.addEventListener("mouseleave", () => setAngryHover(false));
});

// ---- Happy jump on friend hover ----

const friendTriggers = document.querySelectorAll(".friend");

function setHappyHover(happy: boolean) {
  [heroSloppy, roamingSloppy].forEach((el) => {
    if (happy) {
      el.classList.add("happy");
    } else {
      el.classList.remove("happy");
    }
  });
}

friendTriggers.forEach((el) => {
  el.addEventListener("mouseenter", () => setHappyHover(true));
  el.addEventListener("mouseleave", () => setHappyHover(false));
});

// ---- Click roaming sloppy to dismiss ----

let dismissed = false;

roamingSloppy.addEventListener("click", () => {
  if (roamingSloppy.classList.contains("dead")) {
    // Second click — dismiss for good
    dismissed = true;
    roamingSloppy.classList.add("dismissed");
  } else {
    // First click — play dead
    roamingSloppy.classList.remove("visible");
    roamingSloppy.classList.add("dead");
  }
});

// ---- Pause when tab hidden ----

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
  } else {
    rafId = requestAnimationFrame(tick);
  }
});

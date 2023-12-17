const WIDTH = 800;
const HEIGHT = 460;

function length(vec) {
  return Math.sqrt(vec.x * vec.x + vec.y * vec.y);
}

function normal(vec) {
  const len = length(vec);
  return {
    x: vec.x / len,
    y: vec.y / len,
  };
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}

function sub(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
}

function mul(a, vec) {
  return {
    x: a * vec.x,
    y: a * vec.y,
  };
}

function sdfBox(point, dimensions) {
  const delta = {
    x: Math.abs(point.x) - dimensions.x,
    y: Math.abs(point.y) - dimensions.y
  };
  const d = {
    x: Math.max(delta.x, 0),
    y: Math.max(delta.y, 0),
  };
  return length(d) + Math.min(Math.max(delta.x, delta.y), 0);
}

function sdfCircle(point, radius) {
  return Math.sqrt(point.x * point.x + point.y * point.y) - radius;
}

function scene(point) {
  return Math.min(
    sdfBox(sub(point, RECT_CENTER), RECT_RADII),
    sdfCircle(sub(point, CIRCLE_CENTER), CIRCLE_RADIUS),
  );
}

function easeOut(x) {
  return 1 - Math.pow(1 - x, 5);
}

const EPSILON = 1;
const START_CENTER = { x: 150, y: 350 };
const CIRCLE_CENTER = { x: 650, y: 150 };
const CIRCLE_RADIUS = 50;
const RECT_CENTER = { x: 480, y: 350 };
const RECT_RADII = { x: 60, y: 30 };
const MAX_ITERATIONS = 10;

function points() {
  const dir = normal({
    x: CIRCLE_CENTER.x - START_CENTER.x,
    y: CIRCLE_CENTER.y - START_CENTER.y,
  });

  let t = 0;
  const points = [];
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    iterations = i - 1;
    const target = add(START_CENTER, mul(t, dir));
    let d = scene(target);

    if (d < EPSILON) {
      points.push(target);
      break;
    }

    points.push(target);
    t += d;
  }

  return points;
}

function render(ctx, points, now) {
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#00000066";

  ctx.beginPath();
  ctx.rect(
    RECT_CENTER.x - RECT_RADII.x,
    RECT_CENTER.y - RECT_RADII.y,
    RECT_RADII.x * 2,
    RECT_RADII.y * 2,
  );
  ctx.stroke();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(CIRCLE_CENTER.x, CIRCLE_CENTER.y, CIRCLE_RADIUS, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.fill();

  ctx.fillStyle = "#000000";

  ctx.beginPath();
  ctx.arc(START_CENTER.x, START_CENTER.y, 10, 0, 2 * Math.PI);
  ctx.fill();

  let iterations = points.length;
  const seconds = now / 1000;
  for (let i = 0; i < points.length; i++) {
    if (i > seconds) {
      iterations = i;
      break;
    }

    const passed = Math.floor(seconds) > i;
    const within = Math.floor(seconds) == i;
    const ratio = easeOut(within ? (now % 1000) / 1000 : 1);
    const point = points[i];
    const nextPoint = i < points.length ? points[i+1] : undefined;

    if (nextPoint) {
      const dist = length(sub(point, nextPoint));
      const dir = normal(sub(nextPoint, point));
      const next = add(point, mul(dist * ratio, dir));

      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();

      if (!passed) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, ratio * dist, 0, 2 * Math.PI);
        ctx.stroke();
      }

      if (!within) {
        ctx.beginPath();
        ctx.arc(nextPoint.x, nextPoint.y, 5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }

  ctx.font = "48px sans-serif";
  ctx.fillText(iterations, (WIDTH - ctx.measureText(iterations).width) / 2, 50);

  requestAnimationFrame(() => render(ctx, points, performance.now() % (points.length * 1000)));
}

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("raymarch");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  render(ctx, points(), 0);
});

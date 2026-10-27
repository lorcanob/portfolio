// Snellen eye test in the browser.
//
// The test's logic is the same Python as the desktop app, running in Pyodide:
// snellen.web.WebApp drives the screen-size, calibration and chart steps. This file
// only does what Python can't:
// - camera access, plus MediaPipe's JavaScript face landmarker;
// - passing landmarks (and, while calibrating, pixels) to WebApp.frame();
// - passing key presses to WebApp.key();
// - drawing WebApp.view(): text, buttons, example photos, the card bars and the chart.
//
// Screening toy only - not a medical test. Nothing is uploaded: all processing is local.

import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs";
import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs";

const MEDIAPIPE_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const STORAGE_KEY = "snellen.screen"; // {pxPerMm, dpr}: a card measurement on this device
const DEBUG = new URLSearchParams(location.search).has("debug");

const $ = (id) => document.getElementById(id);

// --- loading ------------------------------------------------------------------------

function say(title, text) {
  $("title").textContent = title;
  $("lines").replaceChildren(...[text].flat().map((t) => Object.assign(document.createElement("p"), { textContent: t })));
}

/** Pyodide with numpy, OpenCV and our wheel (installed without its desktop dependencies). */
async function loadPython() {
  const pyodide = await loadPyodide();
  await pyodide.loadPackage(["numpy", "opencv-python", "micropip"]);
  const manifest = await (await fetch("dist/manifest.json")).json();
  const wheelUrl = new URL(`dist/${manifest.wheel}`, location.href).href;
  await pyodide.runPythonAsync(`
import micropip
await micropip.install(${JSON.stringify(wheelUrl)}, deps=False)
`);
  return { pyodide, web: pyodide.pyimport("snellen.web") };
}

async function loadLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
  });
}

/** A Python value as plain JS (dicts become objects), freeing the Python proxy. */
function toJs(value) {
  if (value === null || value === undefined || typeof value !== "object" || !value.toJs) return value;
  const js = value.toJs({ dict_converter: Object.fromEntries });
  value.destroy();
  return js;
}

// --- the saved screen measurement ------------------------------------------------------

/** px/mm measured on this device before, if the zoom level (devicePixelRatio) is the same. */
function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && saved.dpr === window.devicePixelRatio && saved.pxPerMm > 0 ? saved.pxPerMm : undefined;
  } catch {
    return undefined; // private window or blocked storage: measure again
  }
}

function save(pxPerMm) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pxPerMm, dpr: window.devicePixelRatio }));
  } catch {
    // not remembered; harmless
  }
}

// --- camera ----------------------------------------------------------------------------

class Camera {
  constructor(app, landmarker, onFrame) {
    this.app = app;
    this.landmarker = landmarker;
    this.onFrame = onFrame;
    this.video = $("video");
    this.grab = document.createElement("canvas");
    this.grabCtx = this.grab.getContext("2d", { willReadFrequently: true });
    this.started = false;
    this.lastTime = -1;
    this.timings = [];
  }

  async start() {
    if (this.started) return;
    this.started = true;
    try {
      this.video.srcObject = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      await this.video.play();
    } catch (error) {
      this.started = false;
      throw error;
    }
    this.grab.width = $("overlay").width = this.video.videoWidth;
    this.grab.height = $("overlay").height = this.video.videoHeight;
    requestAnimationFrame(() => this.tick());
  }

  tick() {
    requestAnimationFrame(() => this.tick());
    if (this.video.currentTime === this.lastTime) return;
    this.lastTime = this.video.currentTime;
    const start = performance.now();
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    const faces = this.landmarker.detectForVideo(this.video, start).faceLandmarks;
    let rgba; // undefined (not null): Pyodide turns undefined into None
    if (this.app.wants_card) {
      this.grabCtx.drawImage(this.video, 0, 0, w, h);
      rgba = this.grabCtx.getImageData(0, 0, w, h).data;
    }
    const found = toJs(this.app.frame(faces.length ? faces[0] : undefined, w, h, rgba));
    drawOverlay(found);
    this.timings.push(performance.now() - start);
    if (this.timings.length > 30) this.timings.shift();
    this.onFrame();
  }

  get msPerFrame() {
    return this.timings.reduce((a, b) => a + b, 0) / Math.max(1, this.timings.length);
  }
}

function drawOverlay(found) {
  const canvas = $("overlay");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 4;
  if (found.card) {
    ctx.strokeStyle = "#28dc5a";
    ctx.beginPath();
    found.card.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
  }
  if (found.pupils) {
    ctx.strokeStyle = "#28a0ff";
    for (const [x, y] of found.pupils) {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
}

// --- drawing the view -------------------------------------------------------------------

/** Text nodes for a line, with **bold** and *italic* parts (never parsed as HTML). */
function rich(text) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).filter(Boolean).map((part) => {
    const bold = part.startsWith("**") && part.endsWith("**") && part.length > 4;
    const italic = !bold && part.startsWith("*") && part.endsWith("*") && part.length > 2;
    if (!bold && !italic) return document.createTextNode(part);
    const node = document.createElement(bold ? "strong" : "em");
    node.textContent = bold ? part.slice(2, -2) : part.slice(1, -1);
    return node;
  });
}

/** A good or bad example photo; a labelled placeholder until the file is added. */
function example({ src, good, caption }) {
  const figure = document.createElement("figure");
  figure.className = good ? "example good" : "example bad";
  const frame = document.createElement("div");
  frame.className = "frame";
  const img = Object.assign(document.createElement("img"), { src, alt: caption, loading: "lazy" });
  img.addEventListener("error", () => {
    frame.classList.add("missing");
    frame.replaceChildren(Object.assign(document.createElement("span"), { textContent: `Example photo: ${src}` }));
  });
  frame.append(img);
  const label = document.createElement("figcaption");
  label.append(Object.assign(document.createElement("strong"), { textContent: good ? "✅ Do: " : "❌ Don't: " }), caption);
  figure.append(frame, label);
  return figure;
}

let lastPage = ""; // the last drawn page (everything except the live chart), as JSON

function render(app, press) {
  const view = toJs(app.view());
  const { chart, ...page } = view;
  const pageJson = JSON.stringify(page);
  if (pageJson !== lastPage) {
    lastPage = pageJson;
    drawPage(page, press);
  }
  $("chart-wrap").hidden = !chart;
  if (chart) drawChart(chart);
  return view;
}

function drawPage(view, press) {
  $("title").textContent = view.title;
  $("lines").replaceChildren(
    ...view.lines.map((text, i) => {
      const p = document.createElement("p");
      p.append(...rich(text));
      if (i === 0 && view.tone !== "normal") p.className = view.tone;
      return p;
    }),
  );
  $("buttons").replaceChildren(
    ...view.buttons.map((b, i) => {
      const button = document.createElement("button");
      button.textContent = b.label;
      if (i === 0 && !view.answering) button.className = "primary"; // never hint at an answer
      button.addEventListener("click", () => press(b.key));
      return button;
    }),
  );
  $("examples").hidden = !view.examples;
  $("examples").replaceChildren(...(view.examples ?? []).map(example));
  $("bars").hidden = !view.bars;
  if (view.bars) {
    $("bars").replaceChildren(
      ...view.bars.widths_px.map((w, i) => {
        const bar = document.createElement("div");
        bar.className = i === view.bars.selected ? "bar selected" : "bar";
        bar.style.width = `${w}px`;
        return bar;
      }),
    );
  }
  $("progress").hidden = view.progress === undefined;
  if (view.progress !== undefined) $("progress").firstElementChild.style.width = `${100 * view.progress}%`;
  $("preview").hidden = !view.camera;
}

let capRatio; // Optician Sans cap height / font size, measured once

function drawChart(chart) {
  const canvas = $("chart");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  const ctx = canvas.getContext("2d"); // drawn in device pixels, the chart's units
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  $("status").textContent = chart.status;
  $("warning").textContent = chart.warning ?? "";
  const h = chart.height_px;
  if (!h) return;
  if (capRatio === undefined) {
    ctx.font = "100px OpticianSans";
    const m = ctx.measureText("E");
    capRatio = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 100;
  }
  // As in the desktop app: optotypes one width apart, a quarter of the way down (near
  // the camera the distance is measured to), and only the current one if they don't fit.
  const gap = h;
  const count = chart.shapes.length;
  const rowW = count * (h + gap) - gap;
  const top = Math.max(canvas.height / 4 - h / 2, 0);
  let indices = [...Array(count).keys()];
  let left0 = (canvas.width - rowW) / 2;
  if (rowW > canvas.width * 0.95) {
    indices = [chart.position];
    left0 = (canvas.width - h) / 2 - chart.position * (h + gap);
  }
  ctx.fillStyle = "#141414";
  for (const i of indices) {
    drawOptotype(ctx, chart.shapes[i], left0 + i * (h + gap), top, h);
  }
  const markerX = left0 + chart.position * (h + gap) + h / 2;
  const half = Math.max(4 * dpr, h / 4);
  ctx.strokeStyle = "#286ec8";
  ctx.lineWidth = 3 * dpr;
  ctx.beginPath();
  ctx.moveTo(markerX - half, top + 1.5 * h);
  ctx.lineTo(markerX + half, top + 1.5 * h);
  ctx.stroke();
}

function drawOptotype(ctx, shape, left, top, h) {
  const cell = h / 5;
  if (shape.letter) {
    ctx.font = `${h / capRatio}px OpticianSans`;
    const m = ctx.measureText(shape.letter);
    const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    ctx.fillText(shape.letter, left + (h - inkW) / 2 + m.actualBoundingBoxLeft, top + h);
  } else if (shape.cells) {
    for (const [x, y, w, hh] of shape.cells) ctx.fillRect(left + x * cell, top + y * cell, w * cell, hh * cell);
  } else {
    const [outer, inner] = shape.radii;
    const cx = left + 2.5 * cell;
    const cy = top + 2.5 * cell;
    ctx.beginPath();
    ctx.arc(cx, cy, outer * cell, 0, 2 * Math.PI);
    ctx.arc(cx, cy, inner * cell, 0, 2 * Math.PI, true);
    ctx.fill("evenodd");
    const [x, y, w, hh] = shape.gap;
    ctx.fillStyle = "#fff";
    ctx.fillRect(left + x * cell, top + y * cell, w * cell, hh * cell);
    ctx.fillStyle = "#141414";
  }
}

// --- start-up ---------------------------------------------------------------------------

async function main() {
  if (!window.isSecureContext) {
    say("Needs a secure link", "The camera only works on https:// pages. Please open the https:// link.");
    return;
  }
  say("Loading…", [
    "Getting the test ready. The first visit downloads about 25 MB; after that it starts in a few seconds.",
    "Screening toy only, not a medical test. Your camera stays on this device; nothing is uploaded.",
  ]);
  const [{ pyodide, web }, landmarker] = await Promise.all([loadPython(), loadLandmarker()]);
  await document.fonts.load("100px OpticianSans");

  const width = Math.min($("lines").clientWidth || window.innerWidth - 32, 1200);
  const app = web.WebApp(loadSaved(), Math.round(width), window.devicePixelRatio || 1);
  let camera;

  const afterInput = () => {
    const measured = app.measured_px_per_mm;
    if (measured) save(measured);
    const view = render(app, press);
    if (view.stage !== "screen" && !camera.started) {
      camera.start().catch((error) => {
        say("Camera unavailable", [
          `The browser didn't give access to the camera (${error.message}).`,
          "Allow camera access for this site (usually an icon in the address bar), then reload the page.",
        ]);
      });
    }
  };
  function press(key) {
    app.press(key);
    afterInput();
  }
  camera = new Camera(app, landmarker, () => {
    render(app, press);
    if (DEBUG) $("stats").textContent = `${camera.msPerFrame.toFixed(1)} ms/frame`;
  });

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.repeat) {
      event.preventDefault(); // a held key counts once, so it can't skip pages
      return;
    }
    if (app.key(event.key)) {
      event.preventDefault();
      afterInput();
    }
  });
  $("fullscreen").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  });
  $("stats").hidden = !DEBUG;
  if (DEBUG) window.snellen = { app, pyodide, render: () => render(app, press) };
  window.addEventListener("resize", () => {
    lastPage = "";
    render(app, press);
  });
  afterInput();
}

main().catch((error) => {
  console.error(error);
  say("Something went wrong", [`The test couldn't start: ${error.message}`, "Try reloading the page."]);
});

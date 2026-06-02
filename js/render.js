"use strict";

const cv = document.getElementById("cv");
cv.width = W * SCALE;
cv.height = H * SCALE;
const ctx = cv.getContext("2d");

const graph = document.getElementById("massGraph");
graph.width = 320;
graph.height = 230;
const gctx = graph.getContext("2d");

const HEAT_RS = 4;
const fieldCanvas = document.createElement("canvas");
fieldCanvas.width = W * HEAT_RS;
fieldCanvas.height = H * HEAT_RS;
const fctx = fieldCanvas.getContext("2d");
const fieldImg = fctx.createImageData(W * HEAT_RS, H * HEAT_RS);

const objectCanvas = document.createElement("canvas");
objectCanvas.width = W * HEAT_RS;
objectCanvas.height = H * HEAT_RS;
const octx = objectCanvas.getContext("2d");
const objectImg = octx.createImageData(W * HEAT_RS, H * HEAT_RS);

let heatScale = { min: -7, max: 100, mid: (100-7)/2.0 };

function tempColor(temp, range = heatScale){
  const minTemp = range.min;
  const maxTemp = range.max;

  if(window.ICE_RESCUE_THERMAL && window.ICE_RESCUE_THERMAL.tempColor){
    return window.ICE_RESCUE_THERMAL.tempColor(temp, minTemp, maxTemp);
  }

  const u = clamp((temp - minTemp) / (maxTemp - minTemp), 0, 1);
  const stops = [
    [22, 62, 150],
    [40, 180, 210],
    [245, 210, 80],
    [235, 95, 46],
    [153, 27, 27],
  ];
  const scaled = u * (stops.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(stops.length - 1, left + 1);
  const t = scaled - left;
  return [0, 1, 2].map(i => Math.round(stops[left][i] + (stops[right][i] - stops[left][i]) * t));
}

function updateHeatScale(){
  const m = simState.material;
  const values = Array.from(T);
  values.sort((a, b) => a - b);

  const p = value => values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * value)))];
  const cold = p(0.02);
  const hot = p(0.995);
  const baseMin = m.meltTemp + Math.min(simState.objectInitDelta, simState.ambientDelta) - 3;
  const baseMax = m.meltTemp + Math.max(simState.objectInitDelta, simState.ambientDelta) + 16;

  let min = Math.min(baseMin, cold);
  let max = Math.max(baseMax, hot);
  if(max - min < 8) max = min + 8;

  heatScale = {
    min,
    max,
    mid: (min + max) / 2,
  };

  return heatScale;
}

function render(){
  //const range = updateHeatScale();
  drawHeatField(heatScale);
  drawObject();
  drawObstacles();
  drawSources();
  drawGrid();
  if(typeof dragPreview === "undefined" || dragPreview === null) drawObjectContour();
  drawMassGraph();
  updateTemperatureLegend(heatScale);
}

function drawHeatField(range){
  const data = fieldImg.data;
  const rw = W * HEAT_RS;
  const rh = H * HEAT_RS;

  for(let py = 0; py < rh; py++){
    for(let px = 0; px < rw; px++){
      const tx = (px + 0.5) / HEAT_RS - 0.5;
      const ty = (py + 0.5) / HEAT_RS - 0.5;
      const x0 = Math.floor(tx);
      const y0 = Math.floor(ty);
      const fx = tx - x0;
      const fy = ty - y0;
      const cx0 = clamp(x0, 0, W - 1);
      const cx1 = clamp(x0 + 1, 0, W - 1);
      const cy0 = clamp(y0, 0, H - 1);
      const cy1 = clamp(y0 + 1, 0, H - 1);
      const temp =
        T[cy0 * W + cx0] * (1 - fx) * (1 - fy) +
        T[cy0 * W + cx1] * fx * (1 - fy) +
        T[cy1 * W + cx0] * (1 - fx) * fy +
        T[cy1 * W + cx1] * fx * fy;
      const [r, g, b] = tempColor(temp, range);
      const o = (py * rw + px) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }

  fctx.putImageData(fieldImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fieldCanvas, 0, 0, cv.width, cv.height);
}

function updateTemperatureLegend(range){
  const min = document.getElementById("tempScaleMin");
  //const mid = document.getElementById("tempScaleMid");
  const max = document.getElementById("tempScaleMax");
  if(!min  || !max) return;

  min.textContent = `${range.min.toFixed(1)} °C`;
  //mid.textContent = `${range.mid.toFixed(1)} °C`;
  max.textContent = `${range.max.toFixed(1)} °C`;
}

function drawObject(){
  const data = objectImg.data;
  const rw = W * HEAT_RS;
  const rh = H * HEAT_RS;
  const hc = objectHalfCells();
  const visHC = Math.floor(hc + 1e-9) + 0.5;

  const preview = typeof dragPreview !== "undefined" ? dragPreview : null;
  const ocx = preview !== null
    ? preview.cx
    : Math.round(simState.objectCenter.x * W / LX - 0.5);
  const ocy = preview !== null
    ? preview.cy
    : Math.round(simState.objectCenter.y * H / LY - 0.5);

  for(let py = 0; py < rh; py++){
    for(let px = 0; px < rw; px++){
      const tx = (px + 0.5) / HEAT_RS - 0.5;
      const ty = (py + 0.5) / HEAT_RS - 0.5;
      const ddx = tx - ocx;
      const ddy = ty - ocy;

      let cov;
      if(simState.objectShape === "square"){
        cov = clamp(visHC - Math.abs(ddx), 0, 1) *
              clamp(visHC - Math.abs(ddy), 0, 1);
      } else {
        cov = clamp(visHC - Math.sqrt(ddx * ddx + ddy * ddy), 0, 1);
      }

      const o = (py * rw + px) * 4;
      if(cov < 0.004){ data[o + 3] = 0; continue; }

      if(preview !== null){
        if(preview.valid){
          data[o] = 215; data[o + 1] = 246; data[o + 2] = 255;
        } else {
          data[o] = 220; data[o + 1] = 55; data[o + 2] = 55;
        }
        data[o + 3] = Math.round(cov * 150);
      } else {
        const ix = clamp(Math.round(tx), 0, W - 1);
        const iy = clamp(Math.round(ty), 0, H - 1);
        const i = iy * W + ix;
        const solid = objectMask[i] ? 1 - liquidFraction[i] : 0;
        if(solid < 0.01){ data[o + 3] = 0; continue; }
        data[o] = 215;
        data[o + 1] = 246;
        data[o + 2] = 255;
        data[o + 3] = Math.round(cov * (50 + solid * 200));
      }
    }
  }

  octx.putImageData(objectImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(objectCanvas, 0, 0, cv.width, cv.height);
}

function drawObstacles(){
  ctx.imageSmoothingEnabled = false;
  for(let y = 0; y < H; y++){
    for(let x = 0; x < W; x++){
      const m = obstacleMask[idx(x, y)];
      if(m === CELL_EMPTY) continue;

      ctx.fillStyle = m === CELL_INSULATOR
        ? "rgba(117, 78, 39, 0.86)"
        : "rgba(32, 207, 255, 0.52)";
      ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
    }
  }
}

function drawSources(){
  for(const source of simState.sources){
    const x = source.x / LX * cv.width;
    const y = source.y / LY * cv.height;
    const radius = 9;
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 34);
    glow.addColorStop(0, "rgba(255, 230, 92, 0.9)");
    glow.addColorStop(0.4, "rgba(255, 149, 64, 0.35)");
    glow.addColorStop(1, "rgba(255, 149, 64, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffe45c";
    ctx.strokeStyle = "#1a1206";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawGrid(){
  ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for(let p = 0; p <= W; p += 5){
    const x = p * SCALE + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cv.height);
  }
  for(let p = 0; p <= H; p += 5){
    const y = p * SCALE + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(cv.width, y);
  }
  ctx.stroke();
}

function drawObjectContour(){
  const segs = contourSegments();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(245, 252, 255, 0.95)";
  ctx.beginPath();
  const half = SCALE * 0.5;
  for(const s of segs){
    ctx.moveTo(s[0] * SCALE + half, s[1] * SCALE + half);
    ctx.lineTo(s[2] * SCALE + half, s[3] * SCALE + half);
  }
  ctx.stroke();
}

function drawMassGraph(){
  const w = graph.width;
  const h = graph.height;
  gctx.clearRect(0, 0, w, h);
  gctx.fillStyle = "#0b1219";
  gctx.fillRect(0, 0, w, h);

  const padL = 38;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxTime = Math.max(45, simState.timeHistory[simState.timeHistory.length - 1] || 0);

  gctx.strokeStyle = "rgba(255,255,255,.10)";
  gctx.lineWidth = 1;
  gctx.beginPath();
  for(let k = 0; k <= 4; k++){
    const y = padT + plotH * k / 4;
    gctx.moveTo(padL, y);
    gctx.lineTo(w - padR, y);
  }
  for(let k = 0; k <= 4; k++){
    const x = padL + plotW * k / 4;
    gctx.moveTo(x, padT);
    gctx.lineTo(x, h - padB);
  }
  gctx.stroke();

  gctx.fillStyle = "#8ea3b1";
  gctx.font = "11px system-ui, sans-serif";
  gctx.textAlign = "right";
  gctx.textBaseline = "middle";
  for(let k = 0; k <= 4; k++){
    const value = 100 - k * 25;
    const y = padT + plotH * k / 4;
    gctx.fillText(`${value}`, padL - 8, y);
  }

  gctx.textAlign = "center";
  gctx.textBaseline = "top";
  gctx.fillText(`${maxTime.toFixed(0)} c`, padL + plotW, h - padB + 8);
  gctx.fillText("0", padL, h - padB + 8);

  if(simState.massHistory.length < 2) return;

  gctx.strokeStyle = "#7bdcff";
  gctx.lineWidth = 2.2;
  gctx.beginPath();
  for(let i = 0; i < simState.massHistory.length; i++){
    const x = padL + (simState.timeHistory[i] / maxTime) * plotW;
    const y = padT + (1 - clamp(simState.massHistory[i], 0, 105) / 100) * plotH;
    if(i === 0) gctx.moveTo(x, y);
    else gctx.lineTo(x, y);
  }
  gctx.stroke();

  if(simState.meltedAt !== null){
    const mx = padL + (simState.meltedAt / maxTime) * plotW;
    gctx.strokeStyle = "rgba(255, 200, 80, 0.85)";
    gctx.lineWidth = 1.5;
    gctx.setLineDash([4, 4]);
    gctx.beginPath();
    gctx.moveTo(mx, padT);
    gctx.lineTo(mx, padT + plotH);
    gctx.stroke();
    gctx.setLineDash([]);
    gctx.fillStyle = "#ffc850";
    gctx.font = "11px system-ui, sans-serif";
    gctx.textAlign = "center";
    gctx.textBaseline = "top";
    gctx.fillText(`${simState.meltedAt.toFixed(0)} c`, mx, padT + 2);
  }
}

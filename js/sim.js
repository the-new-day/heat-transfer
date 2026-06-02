"use strict";

let T;
let enthalpy;
let obstacleMask;
let objectMask;
let sourceField;
let liquidFraction;
let conductivity;

const simState = {
  materialName: "Водяной лёд",
  material: MATERIALS["Водяной лёд"],
  ambientDelta: 3.0,
  objectInitDelta: -5.0,
  objectCenter: { x: 0.06, y: 0.06 },
  objectSize: 0.03,
  objectShape: "square",
  sourcePower: 8e7,
  sources: [{ x: 0.02, y: 0.02, weight: 1.0 }],
  elapsed: 0,
  initialMass: 1,
  massHistory: [],
  timeHistory: [],
  brushRadius: 1,
  tool: "source",
  running: false,
  speed: 1,
  hSolidMax: 0,
  hLiquidMin: 0,
  meltedAt: null,
};

const idx = (x, y) => y * W + x;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const cellCenterX = x => (x + 0.5) * DX;
const cellCenterY = y => (y + 0.5) * DY;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function updateCriticalEnthalpies(){
  const m = simState.material;
  simState.hSolidMax = m.cp * (m.meltTemp - m.phaseHalfWidth);
  simState.hLiquidMin = m.cp * (m.meltTemp + m.phaseHalfWidth) + m.latentHeat;
}

function tempFromEnthalpyValue(h){
  const m = simState.material;
  if(h < simState.hSolidMax) return h / m.cp;
  if(h > simState.hLiquidMin) return (h - m.latentHeat) / m.cp;

  const denom = m.cp + m.latentHeat / (2 * m.phaseHalfWidth);
  const num = h + m.latentHeat * (m.meltTemp - m.phaseHalfWidth) / (2 * m.phaseHalfWidth);
  return num / denom;
}

function liquidFractionFromTemp(temp){
  const m = simState.material;
  return clamp(
    (temp - (m.meltTemp - m.phaseHalfWidth)) / (2 * m.phaseHalfWidth),
    0,
    1
  );
}

function enthalpyFromTemp(temp){
  const m = simState.material;
  return m.cp * temp + m.latentHeat * liquidFractionFromTemp(temp);
}

function tempFromCellEnthalpy(i){
  if(obstacleMask[i] === CELL_INSULATOR){
    return enthalpy[i] / INSULATOR_MATERIAL.cp;
  }

  return tempFromEnthalpyValue(enthalpy[i]);
}

function enthalpyFromCellTemp(i, temp){
  if(obstacleMask[i] === CELL_INSULATOR){
    return INSULATOR_MATERIAL.cp * temp;
  }

  return enthalpyFromTemp(temp);
}

function densityForCell(i){
  return obstacleMask[i] === CELL_INSULATOR
    ? INSULATOR_MATERIAL.rho
    : simState.material.rho;
}

function ensureArrays(){
  const n = W * H;
  T = new Float32Array(n);
  enthalpy = new Float32Array(n);
  obstacleMask = obstacleMask || new Uint8Array(n);
  objectMask = new Uint8Array(n);
  sourceField = new Float32Array(n);
  liquidFraction = new Float32Array(n);
  conductivity = new Float32Array(n);
}

function calculateSources(){
  sourceField.fill(0);
  for(const source of simState.sources){
    for(let y = 0; y < H; y++){
      const cy = cellCenterY(y);
      for(let x = 0; x < W; x++){
        const i = idx(x, y);
        if(obstacleMask[i] === CELL_INSULATOR) continue;

        const cx = cellCenterX(x);
        const r2 = (cx - source.x) ** 2 + (cy - source.y) ** 2;
        const transmission = directSourceTransmission(source, x, y);
        sourceField[i] += transmission * source.weight * simState.sourcePower *
          Math.exp(-r2 / (2 * SOURCE_SIGMA ** 2));
      }
    }
  }
}

function directSourceTransmission(source, targetX, targetY){
  const sx = clamp(Math.floor(source.x / DX), 0, W - 1);
  const sy = clamp(Math.floor(source.y / DY), 0, H - 1);
  let crossedInsulators = 0;

  for(const cell of rasterLine(sx, sy, targetX, targetY)){
    if(cell.x === targetX && cell.y === targetY) continue;
    if(obstacleMask[idx(cell.x, cell.y)] === CELL_INSULATOR){
      crossedInsulators++;
    }
  }

  return crossedInsulators === 0
    ? 1
    : SOURCE_BLOCKED_TRANSMISSION ** crossedInsulators;
}

function rasterLine(x0, y0, x1, y1){
  const cells = [];
  const dxAbs = Math.abs(x1 - x0);
  const dyAbs = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dxAbs - dyAbs;
  let x = x0;
  let y = y0;

  while(true){
    cells.push({ x, y });
    if(x === x1 && y === y1) break;

    const e2 = 2 * err;
    if(e2 > -dyAbs){
      err -= dyAbs;
      x += sx;
    }
    if(e2 < dxAbs){
      err += dxAbs;
      y += sy;
    }
  }

  return cells;
}

function objectHalfCells(){
  const raw = simState.objectSize * W / (2 * LX);
  const nearest = Math.round(raw * 2) / 2;
  return Math.abs(raw - nearest) < 1e-3 ? nearest : raw;
}

function buildObjectMask(){
  objectMask.fill(0);
  const hc = objectHalfCells();
  const hc2 = hc * hc;
  const ocx = Math.round(simState.objectCenter.x * W / LX - 0.5);
  const ocy = Math.round(simState.objectCenter.y * H / LY - 0.5);

  for(let y = 0; y < H; y++){
    for(let x = 0; x < W; x++){
      const i = idx(x, y);
      if(obstacleMask[i] !== CELL_EMPTY) continue;
      const dx = x - ocx;
      const dy = y - ocy;
      const inside = simState.objectShape === "square"
        ? Math.abs(dx) <= hc + 1e-9 && Math.abs(dy) <= hc + 1e-9
        : dx * dx + dy * dy <= hc2 + 1e-9;
      if(inside) objectMask[i] = 1;
    }
  }
}

function updateThermoFields(){
  const m = simState.material;
  for(let i = 0; i < enthalpy.length; i++){
    const temp = tempFromCellEnthalpy(i);
    T[i] = temp;

    let fl = liquidFractionFromTemp(temp);
    if(obstacleMask[i] !== CELL_EMPTY) fl = 0;
    liquidFraction[i] = fl;

    let k = m.kSolid + (m.kLiquid - m.kSolid) * fl;
    if(obstacleMask[i] === CELL_INSULATOR) k = INSULATOR_MATERIAL.k;
    if(obstacleMask[i] === CELL_COOLER) k = m.kSolid;
    conductivity[i] = k;
  }
}

function currentMass(){
  const m = simState.material;
  let mass = 0;
  for(let i = 0; i < objectMask.length; i++){
    if(objectMask[i]) mass += (1 - liquidFraction[i]) * m.rho * DX * DY;
  }
  return mass;
}

function massPercent(){
  if(simState.initialMass <= 0) return 0;
  return currentMass() / simState.initialMass * 100;
}

function pushHistory(){
  const percent = massPercent();
  simState.timeHistory.push(simState.elapsed);
  simState.massHistory.push(percent);

  if(simState.timeHistory.length > 900){
    simState.timeHistory.shift();
    simState.massHistory.shift();
  }
}

function resetSimulation(){
  ensureArrays();
  updateCriticalEnthalpies();
  calculateSources();
  buildObjectMask();

  const ambient = simState.material.meltTemp + simState.ambientDelta;
  const objectTemp = simState.material.meltTemp + simState.objectInitDelta;
  const coolerTemp = simState.material.meltTemp - 5;

  for(let i = 0; i < W * H; i++){
    let temp = objectMask[i] ? objectTemp : ambient;
    if(obstacleMask[i] === CELL_COOLER) temp = coolerTemp;
    T[i] = temp;
    enthalpy[i] = enthalpyFromCellTemp(i, temp);
  }

  simState.elapsed = 0;
  simState.timeHistory = [];
  simState.massHistory = [];
  simState.meltedAt = null;
  updateThermoFields();
  simState.initialMass = Math.max(currentMass(), 1e-12);
  pushHistory();
}

function harmonicMean(a, b){
  return 2 * a * b / (a + b + 1e-15);
}

function stepSimulation(multiplier = 1){
  const steps = Math.max(1, Math.round(SUBSTEPS * multiplier));
  const m = simState.material;

  for(let s = 0; s < steps; s++){
    updateThermoFields();

    for(let y = 1; y < H - 1; y++){
      for(let x = 1; x < W - 1; x++){
        const i = idx(x, y);
        const ti = T[i];
        const ki = conductivity[i];

        const r = idx(x + 1, y);
        const l = idx(x - 1, y);
        const u = idx(x, y + 1);
        const d = idx(x, y - 1);

        const fluxXR = harmonicMean(ki, conductivity[r]) * (T[r] - ti) / (DX * DX);
        const fluxXL = harmonicMean(ki, conductivity[l]) * (ti - T[l]) / (DX * DX);
        const fluxYU = harmonicMean(ki, conductivity[u]) * (T[u] - ti) / (DY * DY);
        const fluxYD = harmonicMean(ki, conductivity[d]) * (ti - T[d]) / (DY * DY);

        let qActive = sourceField[i];
        if(obstacleMask[i] === CELL_COOLER && ti > m.meltTemp - 15){
          qActive -= simState.sourcePower * 0.25;
        }

        enthalpy[i] += (PHYSICS_DT / densityForCell(i)) * (fluxXR - fluxXL + fluxYU - fluxYD + qActive);
      }
    }

    for(let x = 0; x < W; x++){
      enthalpy[idx(x, 0)] = enthalpy[idx(x, 1)];
      enthalpy[idx(x, H - 1)] = enthalpy[idx(x, H - 2)];
    }
    for(let y = 0; y < H; y++){
      enthalpy[idx(0, y)] = enthalpy[idx(1, y)];
      enthalpy[idx(W - 1, y)] = enthalpy[idx(W - 2, y)];
    }

    simState.elapsed += PHYSICS_DT;
  }

  updateThermoFields();
  pushHistory();
}

function clearScene(){
  simState.sources = [];
  obstacleMask.fill(0);
  resetSimulation();
}

function addSourceAtCell(x, y){
  const cx = cellCenterX(x);
  const cy = cellCenterY(y);
  const existingIdx = simState.sources.findIndex(
    s => Math.abs(s.x - cx) < DX * 0.5 && Math.abs(s.y - cy) < DX * 0.5
  );
  if(existingIdx >= 0){
    simState.sources.splice(existingIdx, 1);
  } else {
    simState.sources.push({ x: cx, y: cy, weight: 1.0 });
  }
  calculateSources();
}

function moveObjectToCell(x, y){
  const marginCells = Math.ceil((simState.objectSize / 2) / DX);
  const cx = clamp(x, marginCells, W - 1 - marginCells);
  const cy = clamp(y, marginCells, H - 1 - marginCells);
  simState.objectCenter = { x: cellCenterX(cx), y: cellCenterY(cy) };
  resetSimulation();
}

function paintObstacle(cx, cy, type){
  let changed = false;
  const r = simState.brushRadius - 1;

  for(let y = cy - r; y <= cy + r; y++){
    for(let x = cx - r; x <= cx + r; x++){
      if(!inBounds(x, y)) continue;
      if((x - cx) ** 2 + (y - cy) ** 2 > r ** 2 + 0.75) continue;

      const i = idx(x, y);
      if(obstacleMask[i] !== type){
        const currentTemp = T ? tempFromCellEnthalpy(i) : simState.material.meltTemp + simState.ambientDelta;
        obstacleMask[i] = type;
        enthalpy[i] = enthalpyFromCellTemp(i, currentTemp);
        T[i] = currentTemp;
        changed = true;
      }
    }
  }

  if(changed){
    calculateSources();
    buildObjectMask();
    updateThermoFields();
  }
}

function computeBgTemperature(){
  const m = simState.material;
  const n = W * H;
  const kbg = new Float32Array(n);
  const rcbg = new Float32Array(n);
  for(let i = 0; i < n; i++){
    if(obstacleMask[i] === CELL_INSULATOR){
      kbg[i] = INSULATOR_MATERIAL.k;
      rcbg[i] = INSULATOR_MATERIAL.rho * INSULATOR_MATERIAL.cp;
    } else {
      kbg[i] = m.kLiquid;
      rcbg[i] = m.rho * m.cp;
    }
  }
  const alphaMax = m.kLiquid / (m.rho * m.cp);
  const dt = 0.45 * DX * DX / (4.0 * alphaMax);
  const Tbg = new Float32Array(n);
  const Tnew = new Float32Array(n);
  for(let iter = 0; iter < 500; iter++){
    for(let y = 1; y < H - 1; y++){
      for(let x = 1; x < W - 1; x++){
        const i = idx(x, y);
        if(obstacleMask[i] === CELL_COOLER){ Tnew[i] = -20; continue; }
        const T_here = Tbg[i];
        const ki = kbg[i];
        const fluxR = harmonicMean(ki, kbg[i + 1]) * (Tbg[i + 1] - T_here) / (DX * DX);
        const fluxL = harmonicMean(ki, kbg[i - 1]) * (T_here - Tbg[i - 1]) / (DX * DX);
        const fluxU = harmonicMean(ki, kbg[i + W]) * (Tbg[i + W] - T_here) / (DY * DY);
        const fluxD = harmonicMean(ki, kbg[i - W]) * (T_here - Tbg[i - W]) / (DY * DY);
        Tnew[i] = T_here + (dt / rcbg[i]) * (fluxR - fluxL + fluxU - fluxD + sourceField[i]);
      }
    }
    for(let x = 0; x < W; x++){
      Tnew[idx(x, 0)] = Tnew[idx(x, 1)];
      Tnew[idx(x, H - 1)] = Tnew[idx(x, H - 2)];
    }
    for(let y = 0; y < H; y++){
      Tnew[idx(0, y)] = Tnew[idx(1, y)];
      Tnew[idx(W - 1, y)] = Tnew[idx(W - 2, y)];
    }
    Tbg.set(Tnew);
  }
  return Tbg;
}

function findOptimalPosition(){
  if(simState.sources.length === 0 && !obstacleMask.some(v => v === CELL_COOLER)){
    return simState.objectCenter;
  }
  const bgT = computeBgTemperature();
  const margin = Math.ceil((simState.objectSize / 2) / DX) + 1;
  let bestScore = Infinity;
  let best = { ...simState.objectCenter };
  for(let cy = margin; cy < H - margin; cy++){
    for(let cx = margin; cx < W - margin; cx++){
      const score = candidateScore(cx, cy, bgT);
      if(score !== null && score < bestScore){
        bestScore = score;
        best = { x: cellCenterX(cx), y: cellCenterY(cy) };
      }
    }
  }
  return best;
}

function candidateScore(cx, cy, bgT){
  const hc = objectHalfCells();
  const hc2 = hc * hc;
  let sum = 0;
  let count = 0;
  for(let y = 0; y < H; y++){
    for(let x = 0; x < W; x++){
      const dx = x - cx;
      const dy = y - cy;
      const inside = simState.objectShape === "square"
        ? Math.abs(dx) <= hc + 1e-9 && Math.abs(dy) <= hc + 1e-9
        : dx * dx + dy * dy <= hc2 + 1e-9;
      if(!inside) continue;
      const i = idx(x, y);
      if(obstacleMask[i] === CELL_INSULATOR) return null;
      sum += bgT[i];
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

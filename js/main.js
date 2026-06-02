"use strict";

const el = id => document.getElementById(id);

let pointerDown = false;
let dragPreview = null;

function populateMaterials(){
  const select = el("materialSelect");
  select.innerHTML = "";

  for(const name of Object.keys(MATERIALS)){
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }

  select.value = simState.materialName;
}

function setActiveButton(container, attr, value){
  for(const button of container.querySelectorAll("button")){
    button.classList.toggle("active", button.dataset[attr] === value);
  }
}

function updateSliderLabels(){
  el("powerValue").textContent = `${(simState.sourcePower / 1e7).toFixed(1)}e7 Вт`;
  el("ambientValue").textContent = `${simState.ambientDelta.toFixed(1)} °C`;
  el("sizeValue").textContent = `${simState.objectSize.toFixed(3)} м`;
  el("brushValue").textContent = `${simState.brushRadius} кл.`;
}

function refreshReadouts(){
  el("timeReadout").textContent = `${simState.elapsed.toFixed(1)} c`;
  el("massReadout").textContent = `${Math.max(0, massPercent()).toFixed(1)}%`;
  el("runBtn").textContent = simState.running ? "Пауза" : "Пуск";
  el("speedBtn").textContent = `${simState.speed}x`;
}

function cellFromPointer(event){
  const rect = cv.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / rect.width * W);
  const y = Math.floor((event.clientY - rect.top) / rect.height * H);
  return { x: clamp(x, 0, W - 1), y: clamp(y, 0, H - 1) };
}

function applyCurrentTool(cell, continuous = false){
  if(!inBounds(cell.x, cell.y)) return;

  switch(simState.tool){
    case "source":
      if(!continuous){
        addSourceAtCell(cell.x, cell.y);
      }
      break;
    case "object":
      updateDragPreview(cell);
      break;
    case "insulator":
      paintObstacle(cell.x, cell.y, CELL_INSULATOR);
      break;
    case "cooler":
      paintObstacle(cell.x, cell.y, CELL_COOLER);
      break;
    case "eraser":
      paintObstacle(cell.x, cell.y, CELL_EMPTY);
      break;
  }
}

function updateDragPreview(cell){
  const marginCells = Math.ceil((simState.objectSize / 2) / DX);
  const cx = clamp(cell.x, marginCells, W - 1 - marginCells);
  const cy = clamp(cell.y, marginCells, H - 1 - marginCells);
  dragPreview = { cx, cy, valid: !footprintOverlapsInsulator(cx, cy) };
}

function wireControls(){
  el("materialSelect").addEventListener("change", event => {
    simState.materialName = event.target.value;
    simState.material = MATERIALS[simState.materialName];
    resetSimulation();
  });

  el("shapeControls").addEventListener("click", event => {
    const button = event.target.closest("button[data-shape]");
    if(!button) return;
    simState.objectShape = button.dataset.shape;
    setActiveButton(el("shapeControls"), "shape", simState.objectShape);
    resetSimulation();
  });

  el("toolControls").addEventListener("click", event => {
    const button = event.target.closest("button[data-tool]");
    if(!button) return;
    simState.tool = button.dataset.tool;
    setActiveButton(el("toolControls"), "tool", simState.tool);
  });

  el("powerSlider").addEventListener("input", event => {
    simState.sourcePower = Number(event.target.value);
    calculateSources();
    updateSliderLabels();
  });

  el("ambientSlider").addEventListener("input", event => {
    simState.ambientDelta = Number(event.target.value);
    updateSliderLabels();
    resetSimulation();
  });

  el("sizeSlider").addEventListener("input", event => {
    simState.objectSize = Number(event.target.value);
    updateSliderLabels();
    resetSimulation();
  });

  el("brushSlider").addEventListener("input", event => {
    simState.brushRadius = Number(event.target.value);
    updateSliderLabels();
  });

  el("runBtn").addEventListener("click", () => {
    simState.running = !simState.running;
  });

  el("stepBtn").addEventListener("click", () => {
    stepSimulation(simState.speed);
  });

  el("speedBtn").addEventListener("click", () => {
    simState.speed = simState.speed === 1 ? 4 : simState.speed === 4 ? 12 : 1;
  });

  el("resetBtn").addEventListener("click", resetSimulation);

  el("clearBtn").addEventListener("click", () => {
    simState.running = false;
    clearScene();
  });

  el("optBtn").addEventListener("click", () => {
    const best = findOptimalPosition();
    simState.objectCenter = best;
    resetSimulation();
  });

  cv.addEventListener("pointerdown", event => {
    pointerDown = true;
    cv.setPointerCapture(event.pointerId);
    applyCurrentTool(cellFromPointer(event), false);
  });

  cv.addEventListener("pointermove", event => {
    if(!pointerDown) return;
    applyCurrentTool(cellFromPointer(event), true);
  });

  cv.addEventListener("pointerup", event => {
    if(simState.tool === "object" && dragPreview !== null){
      if(dragPreview.valid){
        moveObjectToCell(dragPreview.cx, dragPreview.cy);
      }
      dragPreview = null;
    }
    pointerDown = false;
    cv.releasePointerCapture(event.pointerId);
  });

  cv.addEventListener("pointercancel", () => {
    dragPreview = null;
    pointerDown = false;
  });
}

function syncInitialControls(){
  el("powerSlider").value = simState.sourcePower;
  el("ambientSlider").value = simState.ambientDelta;
  el("sizeSlider").value = simState.objectSize;
  el("brushSlider").value = simState.brushRadius;
  setActiveButton(el("shapeControls"), "shape", simState.objectShape);
  setActiveButton(el("toolControls"), "tool", simState.tool);
  updateSliderLabels();
}

function loop(){
  if(simState.running){
    stepSimulation(simState.speed);
    if(simState.meltedAt === null && massPercent() <= 0.5){
      simState.meltedAt = simState.elapsed;
      simState.running = false;
    }
  }

  render();
  refreshReadouts();
  requestAnimationFrame(loop);
}

populateMaterials();
syncInitialControls();
ensureArrays();
resetSimulation();
wireControls();
loop();

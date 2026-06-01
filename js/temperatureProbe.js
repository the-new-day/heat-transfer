"use strict";

(function(){
  let probeCell = null;

  function cellFromEvent(event){
    const rect = cv.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * W);
    const y = Math.floor((event.clientY - rect.top) / rect.height * H);
    return inBounds(x, y) ? { x, y } : null;
  }

  function cellLabel(i){
    if(objectMask[i]) return "объект";
    if(obstacleMask[i] === CELL_INSULATOR) return "изолятор";
    if(obstacleMask[i] === CELL_COOLER) return "охладитель";
    return "поле";
  }

  function drawRoundRect(x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawTemperatureProbe(){
    if(!probeCell || !T) return;

    const x = probeCell.x;
    const y = probeCell.y;
    const i = idx(x, y);
    const px = x * SCALE;
    const py = y * SCALE;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.92)";
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, SCALE, SCALE);

    const line1 = `${T[i].toFixed(1)} °C`;
    const line2 = `${cellLabel(i)} · (${x}, ${y})`;
    const boxW = 142;
    const boxH = 50;
    let boxX = px + 14;
    let boxY = py - boxH - 10;
    if(boxX + boxW > cv.width) boxX = px - boxW - 10;
    if(boxY < 0) boxY = py + 16;

    ctx.fillStyle = "rgba(5, 10, 16, .9)";
    ctx.strokeStyle = "rgba(226, 232, 240, .45)";
    drawRoundRect(boxX, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 15px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(line1, boxX + 10, boxY + 7);

    ctx.fillStyle = "#9fb0bf";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(line2, boxX + 10, boxY + 29);
    ctx.restore();
  }

  cv.addEventListener("pointermove", event => {
    probeCell = cellFromEvent(event);
    const readout = document.getElementById("tempReadout");
    if(probeCell && readout){
      readout.textContent = `${T[idx(probeCell.x, probeCell.y)].toFixed(1)} °C`;
    }
  });

  cv.addEventListener("mouseleave", () => {
    probeCell = null;
    const readout = document.getElementById("tempReadout");
    if(readout) readout.textContent = "--";
  });

  const baseRender = window.render;
  if(typeof baseRender === "function"){
    window.render = function(){
      baseRender();
      drawTemperatureProbe();
    };
  }
})();

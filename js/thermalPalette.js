"use strict";
/*
  Heat field palette isolated from render.js to reduce merge conflicts.
  It maps simulation temperature to a smoother Streamlit-like heat map:
  deep blue -> cyan -> yellow -> orange -> red.
*/

(function(){
  const MIN_TEMP = -5;
  const MAX_TEMP = 55;
  const GAMMA = 0.72;

  const STOPS = [
    { at: 0.00, rgb: [30, 64, 175] },
    { at: 0.25, rgb: [34, 211, 238] },
    { at: 0.50, rgb: [250, 204, 21] },
    { at: 0.68, rgb: [249, 115, 22] },
    { at: 0.82, rgb: [239, 68, 68] },
    { at: 0.92, rgb: [185, 28, 28] },
    { at: 1.00, rgb: [127, 29, 29] },
  ];

  function clamp01(value){
    return Math.max(0, Math.min(1, value));
  }

  function lerp(a, b, t){
    return Math.round(a + (b - a) * t);
  }

  function mixRgb(a, b, t){
    return [
      lerp(a[0], b[0], t),
      lerp(a[1], b[1], t),
      lerp(a[2], b[2], t),
    ];
  }

  function tempColor(temp, minTemp = MIN_TEMP, maxTemp = MAX_TEMP){
    const raw = clamp01((temp - minTemp) / (maxTemp - minTemp));
    const u = Math.pow(raw, GAMMA);

    for(let i = 0; i < STOPS.length - 1; i++){
      const left = STOPS[i];
      const right = STOPS[i + 1];

      if(u >= left.at && u <= right.at){
        const rawLocal = (u - left.at) / (right.at - left.at);
        const local = rawLocal * rawLocal * (3 - 2 * rawLocal);
        return mixRgb(left.rgb, right.rgb, local);
      }
    }

    return STOPS[STOPS.length - 1].rgb;
  }

  window.ICE_RESCUE_THERMAL = {
    tempColor,
    range: { min: MIN_TEMP, max: MAX_TEMP },
  };
})();

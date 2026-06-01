"use strict";

const ISO = 0.5;

function objectFrac(x, y){
  if(!inBounds(x, y)) return 0;
  const i = idx(x, y);
  if(!objectMask[i]) return 0;
  return 1 - liquidFraction[i];
}

const interp = (a, b) => {
  const den = b - a;
  if(Math.abs(den) < 1e-9) return 0.5;
  return (ISO - a) / den;
};

function contourSegments(){
  const segs = [];

  for(let y = 0; y < H - 1; y++){
    for(let x = 0; x < W - 1; x++){
      const f00 = objectFrac(x, y);
      const f10 = objectFrac(x + 1, y);
      const f11 = objectFrac(x + 1, y + 1);
      const f01 = objectFrac(x, y + 1);

      let c = 0;
      if(f00 > ISO) c |= 1;
      if(f10 > ISO) c |= 2;
      if(f11 > ISO) c |= 4;
      if(f01 > ISO) c |= 8;
      if(c === 0 || c === 15) continue;

      const top = () => [x + interp(f00, f10), y];
      const right = () => [x + 1, y + interp(f10, f11)];
      const bottom = () => [x + interp(f01, f11), y + 1];
      const left = () => [x, y + interp(f00, f01)];
      const push = (a, b) => segs.push([a[0], a[1], b[0], b[1]]);

      switch(c){
        case 1: push(left(), top()); break;
        case 2: push(top(), right()); break;
        case 3: push(left(), right()); break;
        case 4: push(right(), bottom()); break;
        case 5: push(left(), top()); push(right(), bottom()); break;
        case 6: push(top(), bottom()); break;
        case 7: push(left(), bottom()); break;
        case 8: push(bottom(), left()); break;
        case 9: push(top(), bottom()); break;
        case 10: push(top(), right()); push(bottom(), left()); break;
        case 11: push(right(), bottom()); break;
        case 12: push(left(), right()); break;
        case 13: push(top(), right()); break;
        case 14: push(left(), top()); break;
      }
    }
  }

  return segs;
}

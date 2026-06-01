"use strict";

const W = 60;
const H = 60;
const SCALE = 10;

const LX = 0.1;
const LY = 0.1;
const DX = LX / W;
const DY = LY / H;

const SOURCE_SIGMA = 0.005;
const SOURCE_BLOCKED_TRANSMISSION = 0.03;
const PHYSICS_DT = 0.01;
const SUBSTEPS = 30;

const CELL_EMPTY = 0;
const CELL_INSULATOR = 1;
const CELL_COOLER = 2;

const SHAPES = {
  square: "Квадрат",
  circle: "Круг",
};

const TOOLS = {
  source: "Источник",
  object: "Объект",
  insulator: "Изолятор",
  cooler: "Охладитель",
  eraser: "Стереть",
};

const INSULATOR_MATERIAL = {
  rho: 160.0,
  cp: 1100.0,
  k: 0.045,
};

const MATERIALS = {
  "Водяной лёд": {
    rho: 917.0,
    cp: 2090.0,
    kSolid: 2.22,
    kLiquid: 0.58,
    latentHeat: 334000.0,
    meltTemp: 0.0,
    phaseHalfWidth: 0.5,
  },
  "Парафин": {
    rho: 900.0,
    cp: 2100.0,
    kSolid: 0.24,
    kLiquid: 0.15,
    latentHeat: 200000.0,
    meltTemp: 54.0,
    phaseHalfWidth: 1.0,
  },
  "Галлий": {
    rho: 5910.0,
    cp: 370.0,
    kSolid: 32.0,
    kLiquid: 29.0,
    latentHeat: 80000.0,
    meltTemp: 29.76,
    phaseHalfWidth: 0.2,
  },
};

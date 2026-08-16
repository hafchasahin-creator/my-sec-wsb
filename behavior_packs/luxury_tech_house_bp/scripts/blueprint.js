/*
 * Luxury Tech House - construction.
 *
 * emitBuild() pushes roughly a thousand /fill and /setblock commands into the
 * queue, which meters them out over a couple of seconds. Coordinates are all
 * relative to the build origin: the south-west corner of the lot, at ground
 * level.
 *
 * Lighting discipline (see plan.js for why): above Y=3 the only light fitting
 * inside the estate box is GLOWSTONE, the only facade strip MARK_EXT and the
 * only neon channel MARK_NEON. Below ground, froglights and sea lanterns are
 * used instead so the smart-lighting fills never touch them.
 */

import { B, Y, PLAN } from "./config.js";
import { ROOMS } from "./plan.js";

const LOT = PLAN.LOT;
const H = PLAN.HOUSE;

/* Stair orientations. Bedrock spells these weirdo_direction; if a device
 * rejects the state the queue retries without it and the stair still lands. */
const FACE = {
  E: '["weirdo_direction"=0]',
  W: '["weirdo_direction"=1]',
  S: '["weirdo_direction"=2]',
  N: '["weirdo_direction"=3]',
  E_UP: '["weirdo_direction"=0,"upside_down_bit"=true]',
  W_UP: '["weirdo_direction"=1,"upside_down_bit"=true]',
  S_UP: '["weirdo_direction"=2,"upside_down_bit"=true]',
  N_UP: '["weirdo_direction"=3,"upside_down_bit"=true]',
};

/* ================================================================== *
 * Shared detail helpers
 * ================================================================== */

/** A wall mounted display: dark bezel, glazed terracotta screen, lit edge. */
function screen(b, axis, plane, a0, a1, y0, y1, panels) {
  const put = (a, y, id) =>
    axis === "x" ? b.set(a, y, plane, id) : b.set(plane, y, a, id);
  const band = (aa0, aa1, yy0, yy1, id) =>
    axis === "x"
      ? b.fill(aa0, yy0, plane, aa1, yy1, plane, id)
      : b.fill(plane, yy0, aa0, plane, yy1, aa1, id);

  band(a0 - 1, a1 + 1, y0 - 1, y1 + 1, B.BLACK);
  for (let a = a0; a <= a1; a++) {
    for (let y = y0; y <= y1; y++) {
      put(a, y, panels[(a - a0 + (y - y0) * 3) % panels.length]);
    }
  }
}

/** Low seating run built from upside-down stairs with a cushion carpet. */
function sofa(b, x0, x1, z0, z1, y, face, frame, cushion) {
  b.fill(x0, y, z0, x1, y, z1, frame, { states: face });
  b.fill(x0, y + 1, z0, x1, y + 1, z1, cushion);
}

/** Planter box with soil and foliage. */
function planter(b, x0, z0, x1, z1, y, rim, leaf) {
  b.fill(x0, y, z0, x1, y, z1, rim);
  b.fill(x0 + 1, y, z0 + 1, x1 - 1, y, z1 - 1, B.MOSS);
  b.fill(x0 + 1, y + 1, z0 + 1, x1 - 1, y + 1, z1 - 1, leaf);
}

/** Slim decorative tree: trunk plus a two-tier canopy. */
function tree(b, x, z, y, height, log, leaf) {
  b.col(x, z, y, y + height - 1, log);
  b.fill(x - 2, y + height - 2, z - 2, x + 2, y + height - 1, z + 2, leaf);
  b.fill(x - 1, y + height, z - 1, x + 1, y + height, z + 1, leaf);
  b.col(x, z, y + height, y + height, log);
}

/** Control console: dark plinth, angled top, glowing readouts. */
function console3(b, x0, x1, z, y, front) {
  b.fill(x0, y, z, x1, y, z, B.DARK);
  b.fill(x0, y + 1, z, x1, y + 1, z, B.BLACKSTONE, { states: front });
  for (let x = x0; x <= x1; x += 2) b.set(x, y + 1, z, B.SCREEN_C);
}

/** A single stylised supercar, 6 long and 3 wide, facing along +Z. */
function car(b, x, z, y, body, trim) {
  const x0 = x;
  const x1 = x + 2;
  // wheels and underbody
  b.fill(x0, y, z, x1, y, z + 5, B.BLACK);
  b.set(x0, y, z + 1, B.DARK);
  b.set(x1, y, z + 1, B.DARK);
  b.set(x0, y, z + 4, B.DARK);
  b.set(x1, y, z + 4, B.DARK);
  // body
  b.fill(x0, y + 1, z, x1, y + 1, z + 5, body);
  b.set(x0 + 1, y + 1, z, trim);
  b.set(x0 + 1, y + 1, z + 5, trim);
  // cabin
  b.fill(x0, y + 2, z + 2, x1, y + 2, z + 3, B.GLASS_BLACK);
  b.set(x0 + 1, y + 2, z + 1, B.GLASS_BLACK);
  b.set(x0 + 1, y + 2, z + 4, B.GLASS_BLACK);
  // lights
  b.set(x0, y + 1, z + 5, B.SCREEN_B);
  b.set(x1, y + 1, z + 5, B.SCREEN_B);
  b.set(x0, y + 1, z, B.SCREEN_RED);
  b.set(x1, y + 1, z, B.SCREEN_RED);
}

/** Bed built from blocks so no bed colour/direction state is involved. */
function bed(b, x0, x1, z0, z1, y, frame, sheet, pillow) {
  b.fill(x0, y, z0, x1, y, z1, frame);
  b.fill(x0, y + 1, z0, x1, y + 1, z1, sheet);
  b.fill(x0, y + 1, z0, x1, y + 1, z0, pillow);
  b.fill(x0 - 1, y + 1, z0 - 1, x0 - 1, y + 1, z0 - 1, B.DARK);
  b.fill(x1 + 1, y + 1, z0 - 1, x1 + 1, y + 1, z0 - 1, B.DARK);
  b.set(x0 - 1, y + 2, z0 - 1, B.GLOWSTONE);
  b.set(x1 + 1, y + 2, z0 - 1, B.GLOWSTONE);
}

/** Bathroom fittings: vanity run, mirror wall, sunken tub. */
function bathroom(b, x0, x1, z0, z1, y, mirrorZ) {
  b.fill(x0, y - 1, z0, x1, y - 1, z1, B.SMOOTH_QUARTZ);
  // vanity along the mirror wall
  b.fill(x0 + 1, y, mirrorZ, x0 + 4, y, mirrorZ, B.DARK);
  b.fill(x0 + 1, y + 1, mirrorZ, x0 + 4, y + 1, mirrorZ, B.SMOOTH_QUARTZ);
  b.set(x0 + 2, y + 1, mirrorZ, B.CAULDRON);
  b.set(x0 + 4, y + 1, mirrorZ, B.CAULDRON);
  b.fill(x0 + 1, y + 2, mirrorZ, x0 + 4, y + 3, mirrorZ, B.GLASS_GRAY);
  // sunken tub
  b.fill(x1 - 4, y - 1, z1 - 3, x1 - 1, y - 1, z1 - 1, B.SMOOTH_QUARTZ);
  b.fill(x1 - 3, y - 1, z1 - 3, x1 - 2, y - 1, z1 - 2, B.WATER);
  // walk-in shower
  b.fill(x1 - 2, y, z0 + 1, x1, y + 3, z0 + 1, B.GLASS);
  b.set(x1 - 1, y + 3, z0 + 2, B.GLOWSTONE);
}

/* ================================================================== *
 * Site preparation
 * ================================================================== */

function prepareSite(b) {
  // Clear everything above ground across the lot, then rebuild the ground.
  b.air(LOT.x0, Y.G, LOT.z0, LOT.x1, Y.PARAPET + 12, LOT.z1);
  b.fill(LOT.x0, -26, LOT.z0, LOT.x1, Y.G_FLOOR, LOT.z1, B.STONE);
  b.fill(LOT.x0, -26, LOT.z0, LOT.x1, -14, LOT.z1, B.DEEPSLATE);
  b.plane(LOT.x0, LOT.z0, LOT.x1, LOT.z1, Y.G_FLOOR, B.MOSS);
}

/* ================================================================== *
 * Shell: floor plates, curtain wall, roof
 * ================================================================== */

function curtainWall(b, plane, axis, a0, a1, yFloor) {
  const yTop = yFloor + 7;
  const put = (aa0, aa1, yy0, yy1, id, opts) =>
    axis === "x"
      ? b.fill(aa0, yy0, plane, aa1, yy1, plane, id, opts)
      : b.fill(plane, yy0, aa0, plane, yy1, aa1, id, opts);

  // full height glazing
  put(a0, a1, yFloor + 1, yTop - 1, B.GLASS);
  // floor band and head band
  put(a0, a1, yFloor, yFloor, B.WHITE);
  put(a0, a1, yTop, yTop, B.BLACK);
  // facade uplight strip, one block below the head band
  put(a0, a1, yTop - 1, yTop - 1, B.MARK_EXT);
  // neon accent band at mid height
  put(a0, a1, yFloor + 4, yFloor + 4, B.MARK_NEON);
  // vertical mullions every six blocks
  for (let a = a0; a <= a1; a += 6) {
    put(a, a, yFloor + 1, yTop - 1, B.WHITE);
  }
  put(a0, a0, yFloor, yTop, B.WHITE);
  put(a1, a1, yFloor, yTop, B.WHITE);
}

function buildShell(b) {
  const floors = [
    [Y.G_FLOOR, B.SMOOTH_QUARTZ],
    [Y.F2_FLOOR, B.SMOOTH_QUARTZ],
    [Y.F3_FLOOR, B.SMOOTH_QUARTZ],
    [Y.ROOF_FLOOR, B.DARK_TILE],
  ];
  for (const [y, mat] of floors) {
    b.plane(H.x0, H.z0, H.x1, H.z1, y, mat);
    // structural rim reads as a shadow gap around every plate
    b.outline(H.x0, H.z0, H.x1, H.z1, y, B.BLACK);
  }

  for (const yFloor of [Y.G_FLOOR, Y.F2_FLOOR, Y.F3_FLOOR]) {
    curtainWall(b, H.z0, "x", H.x0, H.x1, yFloor);
    curtainWall(b, H.z1, "x", H.x0, H.x1, yFloor);
    curtainWall(b, H.x0, "z", H.z0, H.z1, yFloor);
    curtainWall(b, H.x1, "z", H.z0, H.z1, yFloor);
  }

  // Roof parapet: solid base, glass balustrade, capping rail.
  b.walls(H.x0, H.z0, H.x1, H.z1, Y.ROOF, Y.ROOF, B.WHITE);
  b.walls(H.x0, H.z0, H.x1, H.z1, Y.ROOF + 1, Y.PARAPET - 1, B.GLASS);
  b.walls(H.x0, H.z0, H.x1, H.z1, Y.PARAPET, Y.PARAPET, B.BLACK);
  b.wallZ(H.z0, H.x0, H.x1, Y.ROOF, Y.ROOF, B.MARK_EXT);
  b.wallZ(H.z1, H.x0, H.x1, Y.ROOF, Y.ROOF, B.MARK_EXT);

  // Cantilevered balconies: west off the master suite, east off the bedrooms,
  // and a deep terrace across the rear at first floor level.
  const balcony = (x0, z0, x1, z1, yFloor) => {
    b.plane(x0, z0, x1, z1, yFloor, B.DARK_TILE);
    b.outline(x0, z0, x1, z1, yFloor, B.BLACK);
    b.walls(x0, z0, x1, z1, yFloor + 1, yFloor + 2, B.GLASS);
    b.walls(x0, z0, x1, z1, yFloor + 3, yFloor + 3, B.BLACK);
    b.plane(x0 + 1, z0 + 1, x1 - 1, z1 - 1, yFloor + 1, B.AIR);
    b.plane(x0 + 1, z0 + 1, x1 - 1, z1 - 1, yFloor + 2, B.AIR);
    b.plane(x0 + 1, z0 + 1, x1 - 1, z1 - 1, yFloor + 3, B.AIR);
  };
  balcony(H.x0 - 4, 20, H.x0, 34, Y.F2_FLOOR);
  balcony(H.x1, 20, H.x1 + 4, 34, Y.F2_FLOOR);
  balcony(H.x0 - 4, 20, H.x0, 30, Y.F3_FLOOR);
  balcony(H.x1, 20, H.x1 + 4, 30, Y.F3_FLOOR);
  balcony(12, H.z1, 44, H.z1 + 4, Y.F2_FLOOR);

  // Entrance canopy over the driveway drop-off.
  b.plane(24, 12, 43, H.z0, Y.G + 5, B.WHITE);
  b.outline(24, 12, 43, H.z0, Y.G + 5, B.BLACK);
  b.plane(25, 13, 42, H.z0 - 1, Y.G + 4, B.MARK_EXT);
  for (const x of [24, 43]) {
    b.col(x, 13, Y.G, Y.G + 4, B.BLACK);
    b.col(x, 13, Y.G + 1, Y.G + 3, B.MARK_NEON);
  }
}

/* ================================================================== *
 * Vertical circulation: glass lift, sculptural stair, atrium void
 * ================================================================== */

function buildCirculation(b) {
  const S = PLAN.SHAFT;
  const C = PLAN.CAB;
  const T = PLAN.STAIR;

  // Glass lift shaft from the garage all the way to the roof house. The west
  // face is solid: it doubles as the spine wall and gives the in-cab call
  // buttons something they can actually hang on.
  b.fill(S.x0, Y.GAR_FLOOR, S.z0, S.x1, Y.ROOF + 5, S.z1, B.GLASS);
  b.fill(S.x0, Y.GAR_FLOOR, S.z0, S.x0, Y.ROOF + 5, S.z1, B.WHITE);
  b.air(C.x0, Y.GAR_FLOOR + 1, C.z0, C.x1, Y.ROOF + 4, C.z1);
  for (const x of [S.x0, S.x1]) {
    b.col(x, S.z0, Y.GAR_FLOOR, Y.ROOF + 5, B.BLACK);
    b.col(x, S.z1, Y.GAR_FLOOR, Y.ROOF + 5, B.BLACK);
  }
  // corner neon and a cab rail
  for (let y = Y.GAR; y <= Y.ROOF + 4; y += 4) {
    b.outline(S.x0, S.z0, S.x1, S.z1, y, B.MARK_NEON);
    b.air(C.x0, y, C.z0, C.x1, y, C.z1);
  }
  b.plane(C.x0, C.z0, C.x1, C.z1, Y.GAR_FLOOR, B.DARK_TILE);
  b.plane(S.x0, S.z0, S.x1, S.z1, Y.ROOF + 5, B.BLACK);

  /* Secure lift: library vestibule down to the command centre, threaded
   * through the gym corner and the garage as a solid service core. */
  const K = PLAN.SECURE;
  const KC = PLAN.SECURE_CAB;
  b.fill(K.x0, Y.DEEP_FLOOR, K.z0, K.x1, Y.F2 + 7, K.z1, B.DARK);
  b.air(KC.x0, Y.DEEP_FLOOR + 1, KC.z0, KC.x1, Y.F2 + 6, KC.z1);
  b.plane(KC.x0, KC.z0, KC.x1, KC.z1, Y.DEEP_FLOOR, B.DARK_TILE);
  for (let y = Y.DEEP; y <= Y.F2 + 6; y += 4) {
    b.outline(K.x0, K.z0, K.x1, K.z1, y, B.MARK_NEON);
    b.air(KC.x0, y, KC.z0, KC.x1, y, KC.z1);
  }

  // Sculptural stair: one straight flight per storey, alternating direction,
  // wrapped in a glass balustrade.
  const flights = [
    [Y.GAR, T.z1, -1],
    [Y.G, T.z0, 1],
    [Y.F2, T.z1, -1],
    [Y.F3, T.z0, 1],
  ];
  for (const [yStand, zStart, dz] of flights) {
    b.stairRun(T.x0, T.x1, zStart, dz, 8, yStand, B.SMOOTH_QUARTZ, 6);
  }
  /* One glass balustrade on the lobby side; the x=38 spine closes the other.
   * It stops one block short of z1 so each flight's arrival end opens onto the
   * landing instead of being walled off from it. */
  b.fill(T.x0 - 1, Y.GAR, T.z0, T.x0 - 1, Y.ROOF, T.z1 - 1, B.GLASS);
  b.air(T.x0, Y.ROOF, T.z0 + 1, T.x1, Y.ROOF + 4, T.z1);

  // Atrium: punch the first and second floor plates open.
  const A = PLAN.ATRIUM;
  for (const y of [Y.F2_FLOOR, Y.F3_FLOOR]) {
    b.plane(A.x0, A.z0, A.x1, A.z1, y, B.AIR);
    b.outline(A.x0 - 1, A.z0 - 1, A.x1 + 1, A.z1 + 1, y, B.BLACK);
    b.walls(A.x0 - 1, A.z0 - 1, A.x1 + 1, A.z1 + 1, y + 1, y + 2, B.GLASS);
    b.plane(A.x0, A.z0, A.x1, A.z1, y + 1, B.AIR);
    b.plane(A.x0, A.z0, A.x1, A.z1, y + 2, B.AIR);
  }

  /* Multi-storey waterfall: a header channel at the top of the atrium spills
   * over an open lip and falls three floors into a lit catch basin. */
  b.fill(29, Y.F3 + 5, A.z1 - 1, 35, Y.F3 + 6, A.z1, B.DARK_TILE);
  b.fill(30, Y.F3 + 6, A.z1 - 1, 34, Y.F3 + 6, A.z1, B.WATER);
  b.fill(30, Y.F3 + 5, A.z1 - 2, 34, Y.F3 + 5, A.z1 - 2, B.AIR);
  b.fill(29, Y.G, A.z1, 35, Y.F3 + 5, A.z1, B.GLASS_BLACK);
  b.fill(30, Y.G, A.z1 - 1, 34, Y.F3 + 4, A.z1 - 1, B.AIR);
  // catch basin
  b.fill(28, Y.G_FLOOR - 2, A.z1 - 3, 36, Y.G_FLOOR - 2, A.z1, B.DARK_TILE);
  b.fill(29, Y.G_FLOOR - 1, A.z1 - 3, 35, Y.G_FLOOR, A.z1 - 1, B.WATER);
  b.outline(28, A.z1 - 3, 36, A.z1, Y.G_FLOOR, B.BLACK);
  b.fill(29, Y.G_FLOOR - 2, A.z1 - 2, 35, Y.G_FLOOR - 2, A.z1 - 1, B.MARK_POOL);
}

/* ================================================================== *
 * Ground floor
 * ================================================================== */

function interiorShellFor(b, yStand, ceilingRing = true) {
  const yTop = yStand + 6;
  // interior ceiling cove ring - the whole storey's ambient light
  if (ceilingRing) {
    b.outline(H.x0 + 1, H.z0 + 1, H.x1 - 1, H.z1 - 1, yTop, B.GLOWSTONE);
  }
  // partition spines
  b.wallX(26, H.z0 + 1, H.z1 - 1, yStand, yTop, B.WHITE);
  b.wallX(38, H.z0 + 1, H.z1 - 1, yStand, yTop, B.WHITE);
  // neon reveal either side of each spine
  b.wallX(26, H.z0 + 1, H.z1 - 1, yStand + 4, yStand + 4, B.MARK_NEON);
  b.wallX(38, H.z0 + 1, H.z1 - 1, yStand + 4, yStand + 4, B.MARK_NEON);
  b.wallX(26, H.z0 + 1, H.z1 - 1, yStand + 5, yStand + 5, B.GLASS_CYAN);
  b.wallX(38, H.z0 + 1, H.z1 - 1, yStand + 5, yStand + 5, B.GLASS_CYAN);
}

function buildGroundFloor(b) {
  const y = Y.G;
  interiorShellFor(b, y);

  // cross walls
  b.wallZ(33, ROOMS.W.x0, ROOMS.W.x1, y, y + 6, B.WHITE); // living | aquarium
  b.wallZ(39, ROOMS.W.x0, ROOMS.W.x1, y, y + 6, B.WHITE); // aquarium | pool hall
  b.wallZ(30, ROOMS.E.x0, ROOMS.E.x1, y, y + 6, B.WHITE); // kitchen | dining
  b.wallZ(41, ROOMS.E.x0, ROOMS.E.x1, y, y + 6, B.WHITE); // dining | bath + gym
  b.wallX(45, 42, 48, y, y + 6, B.WHITE); // guest bath | gym

  /* ---- grand foyer -------------------------------------------------- */
  b.plane(27, 19, 37, 27, Y.G_FLOOR, B.DARK_TILE);
  b.disc(32, 23, 4, Y.G_FLOOR, B.SMOOTH_QUARTZ);
  b.disc(32, 23, 4, Y.G_FLOOR, B.MARK_PATH, 3);
  // reception desk and a floating art wall
  b.fill(29, y, 25, 35, y, 25, B.DARK);
  b.fill(29, y + 1, 25, 35, y + 1, 25, B.SMOOTH_QUARTZ, { states: FACE.S_UP });
  b.set(32, y + 1, 25, B.SCREEN_C);
  screen(b, "x", 20, 29, 35, y + 2, y + 4, [B.SCREEN_A, B.SCREEN_B, B.SCREEN_C]);
  planter(b, 27, 19, 29, 21, y, B.DARK, B.AZALEA_FLOWER);
  planter(b, 35, 19, 37, 21, y, B.DARK, B.AZALEA_FLOWER);
  b.col(28, 26, y, y + 5, B.MARK_NEON);
  b.col(36, 26, y, y + 5, B.MARK_NEON);

  /* ---- living room -------------------------------------------------- */
  const L = { x0: ROOMS.W.x0, x1: ROOMS.W.x1, z0: 19, z1: 32 };
  b.plane(L.x0, L.z0, L.x1, L.z1, Y.G_FLOOR, B.SMOOTH_QUARTZ);
  b.plane(L.x0 + 3, L.z0 + 3, L.x1 - 3, L.z1 - 4, Y.G_FLOOR, B.CARPET_LGRAY);
  // sunken conversation pit around a long media wall
  sofa(b, 10, 20, 22, 22, y, FACE.N_UP, B.ST_DARK, B.CARPET_WHITE);
  sofa(b, 10, 20, 28, 28, y, FACE.S_UP, B.ST_DARK, B.CARPET_WHITE);
  sofa(b, 9, 9, 23, 27, y, FACE.E_UP, B.ST_DARK, B.CARPET_WHITE);
  b.fill(13, y, 24, 17, y, 26, B.DARK_TILE);
  b.fill(14, y + 1, 25, 16, y + 1, 25, B.GLASS_BLACK);
  // media wall with an oversized screen
  screen(b, "z", 21, 22, 29, y + 1, y + 4, [B.SCREEN_D, B.SCREEN_A, B.SCREEN_E]);
  b.fill(21, y, 21, 21, y, 30, B.DARK);
  b.fill(21, y + 5, 21, 21, y + 5, 30, B.MARK_NEON);
  // grand piano corner and a bar
  b.fill(9, y, 30, 12, y, 32, B.BLACK);
  b.fill(9, y + 1, 30, 11, y + 1, 30, B.DARK, { states: FACE.N_UP });
  b.set(12, y + 1, 31, B.NOTE_BLOCK);
  b.fill(23, y, 19, 25, y, 21, B.DARK);
  b.fill(23, y + 1, 19, 25, y + 1, 21, B.SMOOTH_QUARTZ);
  b.set(24, y + 1, 20, B.BREWING);
  planter(b, 22, 30, 25, 32, y, B.DARK, B.MANGROVE_LEAVES);

  /* ---- walk-through aquarium ---------------------------------------- */
  const A = { z0: 34, z1: 38 };
  b.plane(ROOMS.W.x0, A.z0, ROOMS.W.x1, A.z1, Y.G_FLOOR, B.DARK_TILE);
  for (const [tx0, tx1] of [
    [ROOMS.W.x0 + 1, 14],
    [18, ROOMS.W.x1 - 1],
  ]) {
    b.fill(tx0, y, A.z0, tx1, y + 5, A.z1, B.GLASS);
    b.fill(tx0 + 1, y - 1, A.z0 + 1, tx1 - 1, y + 4, A.z1 - 1, B.WATER);
    b.fill(tx0 + 1, y - 1, A.z0 + 1, tx1 - 1, y - 1, A.z1 - 1, B.SAND);
    b.set(tx0 + 2, y, A.z0 + 1, B.CORAL_BRAIN);
    b.set(tx1 - 2, y, A.z1 - 1, B.CORAL_TUBE);
    b.set(tx0 + 3, y, A.z1 - 1, B.CORAL_FIRE);
    b.set(tx1 - 3, y, A.z0 + 1, B.CORAL_HORN);
    b.set(tx0 + 4, y + 1, A.z0 + 2, B.CORAL_BUBBLE);
    b.fill(tx0, y + 6, A.z0, tx1, y + 6, A.z1, B.GLOWSTONE);
  }
  b.fill(15, y, A.z0, 17, y + 5, A.z1, B.AIR);
  b.plane(15, A.z0, 17, A.z1, Y.G_FLOOR, B.DARK_TILE);
  b.fill(15, y + 5, A.z0, 17, y + 5, A.z1, B.GLASS);

  /* ---- indoor swimming pool ----------------------------------------- */
  const P = { x0: ROOMS.W.x0, x1: ROOMS.W.x1, z0: 40, z1: 48 };
  b.plane(P.x0, P.z0, P.x1, P.z1, Y.G_FLOOR, B.SMOOTH_QUARTZ);
  b.fill(P.x0 + 2, Y.G_FLOOR - 2, P.z0 + 2, P.x1 - 2, Y.G_FLOOR, P.z1 - 2, B.AIR);
  b.plane(P.x0 + 2, P.z0 + 2, P.x1 - 2, P.z1 - 2, Y.G_FLOOR - 2, B.MARK_POOL);
  b.fill(P.x0 + 2, Y.G_FLOOR - 1, P.z0 + 2, P.x1 - 2, Y.G_FLOOR, P.z1 - 2, B.WATER);
  b.outline(P.x0 + 1, P.z0 + 1, P.x1 - 1, P.z1 - 1, Y.G_FLOOR, B.DARK_TILE);
  // loungers and a steam room
  for (const z of [P.z0 + 1, P.z1 - 1]) {
    b.fill(P.x0 + 4, y, z, P.x0 + 6, y, z, B.ST_SMOOTH_QUARTZ, { states: FACE.E_UP });
    b.fill(P.x1 - 6, y, z, P.x1 - 4, y, z, B.ST_SMOOTH_QUARTZ, { states: FACE.W_UP });
  }
  b.fill(P.x1 - 3, y, P.z1 - 3, P.x1 - 1, y + 3, P.z1 - 1, B.GLASS_WHITE);
  b.fill(P.x1 - 2, y, P.z1 - 2, P.x1 - 2, y + 2, P.z1 - 2, B.AIR);
  b.set(P.x1 - 2, y + 3, P.z1 - 2, B.GLOWSTONE);

  /* ---- kitchen ------------------------------------------------------- */
  const K = { x0: ROOMS.E.x0, x1: ROOMS.E.x1, z0: 19, z1: 29 };
  b.plane(K.x0, K.z0, K.x1, K.z1, Y.G_FLOOR, B.DARK_TILE);
  // run of units along the spine wall
  b.fill(K.x0, y, 26, K.x0, y + 1, 28, B.BLACK);
  b.fill(K.x0 + 1, y, 20, K.x0 + 1, y, 28, B.DARK);
  b.fill(K.x0 + 1, y + 1, 20, K.x0 + 1, y + 1, 28, B.SMOOTH_QUARTZ);
  b.set(K.x0 + 1, y + 1, 22, B.SMOKER);
  b.set(K.x0 + 1, y + 1, 24, B.BLAST_FURNACE);
  b.set(K.x0 + 1, y + 1, 26, B.CAULDRON);
  b.fill(K.x0 + 1, y + 3, 20, K.x0 + 1, y + 4, 28, B.BLACK);
  b.fill(K.x0 + 2, y + 6, 20, K.x0 + 2, y + 6, 28, B.GLOWSTONE);
  // island with breakfast seating
  b.fill(45, y, 22, 51, y, 24, B.DARK);
  b.fill(45, y + 1, 22, 51, y + 1, 24, B.SMOOTH_QUARTZ);
  b.set(47, y + 1, 23, B.CAULDRON);
  b.set(49, y + 1, 23, B.CRAFTING);
  for (let x = 46; x <= 50; x += 2) {
    b.set(x, y, 26, B.DARK);
    b.set(x, y + 1, 26, B.CARPET_BLACK);
  }
  // pantry wall
  b.fill(K.x1 - 1, y, 20, K.x1 - 1, y + 2, 22, B.BARREL);
  b.fill(K.x1 - 1, y, 27, K.x1 - 1, y + 2, 28, B.BARREL);

  /* ---- dining room --------------------------------------------------- */
  const D = { x0: ROOMS.E.x0, x1: ROOMS.E.x1, z0: 31, z1: 40 };
  b.plane(D.x0, D.z0, D.x1, D.z1, Y.G_FLOOR, B.SMOOTH_QUARTZ);
  b.plane(D.x0 + 2, D.z0 + 1, D.x1 - 2, D.z1 - 1, Y.G_FLOOR, B.CARPET_GRAY);
  // 12 seat table
  b.fill(45, y, 33, 51, y, 34, B.DARK);
  b.fill(45, y + 1, 33, 51, y + 1, 34, B.BLACK);
  for (let x = 45; x <= 51; x += 2) {
    b.set(x, y, 32, B.ST_DARK, FACE.N);
    b.set(x, y, 35, B.ST_DARK, FACE.S);
  }
  // suspended light sculpture
  b.fill(46, y + 5, 33, 50, y + 5, 34, B.GLOWSTONE);
  b.fill(46, y + 4, 33, 50, y + 4, 34, B.CHAIN);
  // sideboard and wine wall
  b.fill(D.x1 - 1, y, 32, D.x1 - 1, y + 1, 39, B.DARK);
  b.fill(D.x1 - 1, y + 2, 32, D.x1 - 1, y + 4, 39, B.GLASS_BLACK);
  b.set(D.x1 - 1, y + 2, 35, B.BREWING);
  b.set(D.x1 - 1, y + 2, 37, B.BREWING);

  /* ---- guest bathroom ------------------------------------------------ */
  b.plane(39, 42, 44, 48, Y.G_FLOOR, B.DARK_TILE);
  bathroom(b, 39, 44, 42, 48, y, 48);

  /* ---- gym ----------------------------------------------------------- */
  const G = { x0: 46, x1: ROOMS.E.x1, z0: 42, z1: 48 };
  b.plane(G.x0, G.z0, G.x1, G.z1, Y.G_FLOOR, B.BLACK);
  b.plane(G.x0 + 1, G.z0 + 1, G.x1 - 1, G.z1 - 1, Y.G_FLOOR, B.CARPET_BLACK);
  // mirrored wall
  b.fill(G.x0, y, G.z1, G.x1, y + 4, G.z1, B.GLASS_GRAY);
  // rack of weights, benches, a treadmill row
  for (let x = G.x0 + 1; x <= G.x0 + 5; x += 2) {
    b.set(x, y, G.z0 + 1, B.ANVIL);
    b.set(x, y, G.z0 + 2, B.DARK);
  }
  for (let x = G.x0 + 7; x <= G.x1 - 1; x += 3) {
    b.fill(x, y, G.z0 + 1, x, y, G.z0 + 3, B.DARK);
    b.set(x, y + 1, G.z0 + 1, B.SCREEN_C);
    b.fill(x, y + 1, G.z0 + 2, x, y + 1, G.z0 + 3, B.BARS);
  }
  b.fill(G.x0 + 1, y, G.z1 - 2, G.x0 + 4, y, G.z1 - 1, B.CARPET_RED);
  b.fill(G.x1 - 3, y, G.z1 - 2, G.x1 - 1, y + 1, G.z1 - 2, B.BARS);
}

/* ================================================================== *
 * First floor: master suite, bedrooms, bathrooms, office, library
 * ================================================================== */

function buildFloor2(b) {
  const y = Y.F2;
  interiorShellFor(b, y);

  b.wallZ(33, ROOMS.W.x0, ROOMS.W.x1, y, y + 6, B.WHITE);
  b.wallZ(41, ROOMS.W.x0, ROOMS.W.x1, y, y + 6, B.WHITE);
  b.wallZ(29, ROOMS.E.x0, ROOMS.E.x1, y, y + 6, B.WHITE);
  b.wallZ(34, ROOMS.E.x0, ROOMS.E.x1, y, y + 6, B.WHITE);
  b.wallX(48, 19, 28, y, y + 6, B.WHITE);
  b.wallX(47, 35, 48, y, y + 6, B.WHITE);

  /* ---- master bedroom ------------------------------------------------ */
  const M = { x0: ROOMS.W.x0, x1: ROOMS.W.x1, z0: 19, z1: 32 };
  b.plane(M.x0, M.z0, M.x1, M.z1, Y.F2_FLOOR, B.SMOOTH_QUARTZ);
  b.plane(M.x0 + 2, M.z0 + 2, M.x1 - 2, M.z1 - 2, Y.F2_FLOOR, B.CARPET_LGRAY);
  bed(b, 14, 18, 21, 25, y, B.DARK, B.WOOL_WHITE, B.WOOL_LGRAY);
  // headboard wall and mood strip
  b.fill(12, y, 20, 20, y + 4, 20, B.DARK);
  b.fill(12, y + 5, 20, 20, y + 5, 20, B.MARK_NEON);
  screen(b, "z", 30, 13, 19, y + 2, y + 4, [B.SCREEN_D, B.SCREEN_A]);
  // seating, desk, dressing run
  sofa(b, 13, 19, 28, 28, y, FACE.N_UP, B.ST_DARK, B.CARPET_WHITE);
  b.fill(9, y, 22, 9, y + 1, 27, B.DARK);
  b.fill(9, y + 2, 22, 9, y + 4, 27, B.GLASS_GRAY);
  b.fill(M.x1 - 2, y, 30, M.x1, y, 32, B.DARK);
  b.set(M.x1 - 1, y + 1, 31, B.GLOWSTONE);
  planter(b, 8, 30, 10, 32, y, B.DARK, B.CHERRY_LEAVES);

  /* ---- master bathroom ----------------------------------------------- */
  b.plane(ROOMS.W.x0, 34, ROOMS.W.x1, 40, Y.F2_FLOOR, B.SMOOTH_QUARTZ);
  bathroom(b, ROOMS.W.x0, ROOMS.W.x1, 34, 40, y, 35);
  b.fill(18, y - 1, 36, 24, y - 1, 39, B.MARK_EXT);
  b.fill(18, y, 36, 24, y, 39, B.WATER);
  b.outline(17, 35, 25, 40, Y.F2_FLOOR, B.DARK_TILE);

  /* ---- office --------------------------------------------------------- */
  const O = { x0: ROOMS.W.x0, x1: ROOMS.W.x1, z0: 42, z1: 48 };
  b.plane(O.x0, O.z0, O.x1, O.z1, Y.F2_FLOOR, B.DARK_TILE);
  b.plane(O.x0 + 2, O.z0 + 1, O.x1 - 2, O.z1 - 1, Y.F2_FLOOR, B.CARPET_BLACK);
  b.fill(12, y, 45, 20, y, 46, B.DARK);
  b.fill(12, y + 1, 45, 20, y + 1, 46, B.BLACKSTONE);
  for (let x = 13; x <= 19; x += 3) b.set(x, y + 1, 46, B.SCREEN_C);
  b.set(16, y, 44, B.ST_DARK, FACE.N);
  screen(b, "z", 48, 12, 20, y + 2, y + 4, [B.SCREEN_A, B.SCREEN_C, B.SCREEN_E]);
  b.fill(O.x0 + 1, y, O.z0, O.x0 + 1, y + 3, O.z0 + 3, B.BOOKSHELF);
  b.set(O.x1 - 1, y, O.z0 + 1, B.LECTERN);

  /* ---- bedrooms two and three ----------------------------------------- */
  const suites = [
    { x0: ROOMS.E.x0, x1: 47, accent: B.CARPET_BLUE, leaf: B.AZALEA_LEAVES },
    { x0: 49, x1: ROOMS.E.x1, accent: B.CARPET_CYAN, leaf: B.CHERRY_LEAVES },
  ];
  for (const s of suites) {
    b.plane(s.x0, 19, s.x1, 28, Y.F2_FLOOR, B.SMOOTH_QUARTZ);
    b.plane(s.x0 + 1, 20, s.x1 - 1, 27, Y.F2_FLOOR, s.accent);
    bed(b, s.x0 + 3, s.x0 + 5, 21, 24, y, B.DARK, B.WOOL_WHITE, B.WOOL_GRAY);
    b.fill(s.x0 + 1, y, 20, s.x1 - 1, y + 4, 20, B.DARK);
    b.fill(s.x0 + 1, y + 5, 20, s.x1 - 1, y + 5, 20, B.MARK_NEON);
    screen(b, "z", 20, s.x0 + 3, s.x1 - 2, y + 2, y + 3, [B.SCREEN_A, B.SCREEN_B]);
    b.fill(s.x1 - 2, y, 26, s.x1 - 1, y, 27, B.DARK);
    b.set(s.x1 - 2, y + 1, 26, B.GLOWSTONE);
    planter(b, s.x0 + 1, 26, s.x0 + 2, 27, y, B.DARK, s.leaf);
  }
  // corridor
  b.plane(ROOMS.E.x0, 30, ROOMS.E.x1, 33, Y.F2_FLOOR, B.DARK_TILE);
  b.dotsX(ROOMS.E.x0 + 1, ROOMS.E.x1 - 1, 30, Y.F2_FLOOR, 4, B.MARK_NEON);
  b.dotsX(ROOMS.E.x0 + 1, ROOMS.E.x1 - 1, 33, Y.F2_FLOOR, 4, B.MARK_NEON);

  /* ---- family bathroom ------------------------------------------------ */
  b.plane(ROOMS.E.x0, 35, 46, 48, Y.F2_FLOOR, B.SMOOTH_QUARTZ);
  bathroom(b, ROOMS.E.x0, 46, 35, 48, y, 36);

  /* ---- library, with the secret wall at its far end -------------------- */
  const L = { x0: 48, x1: ROOMS.E.x1, z0: 35, z1: 42 };
  b.plane(L.x0, L.z0, L.x1, L.z1, Y.F2_FLOOR, B.DARK_TILE);
  b.plane(L.x0 + 1, L.z0 + 1, L.x1 - 1, L.z1 - 1, Y.F2_FLOOR, B.CARPET_RED);
  b.fill(L.x0, y, L.z0, L.x0, y + 4, L.z1, B.BOOKSHELF);
  b.fill(L.x1, y, L.z0, L.x1, y + 4, L.z1, B.BOOKSHELF);
  b.fill(L.x0, y, L.z0, L.x1, y + 4, L.z0, B.BOOKSHELF);
  b.fill(L.x0 + 1, y, L.z0, L.x1 - 1, y + 4, L.z0, B.CHISELED_BOOKSHELF);
  b.fill(L.x0 + 2, y, 38, L.x1 - 2, y, 39, B.DARK);
  b.fill(L.x0 + 2, y + 1, 38, L.x1 - 2, y + 1, 39, B.BLACKSTONE);
  b.set(L.x0 + 2, y, 40, B.ST_DARK, FACE.S);
  b.set(L.x1 - 2, y, 40, B.ST_DARK, FACE.S);
  // reading lamp cove
  b.fill(L.x0 + 1, y + 6, L.z0 + 1, L.x1 - 1, y + 6, L.z1 - 1, B.GLOWSTONE);
  // the tell: a lectern and one out of place shelf beside the moving wall
  b.set(55, y, 42, B.LECTERN);
  b.set(53, y, 42, B.BOOKSHELF);
  b.set(53, y + 1, 42, B.CHISELED_BOOKSHELF);
  // the secret wall itself is the door "secret_shelf"; flank it with shelving
  b.wallZ(43, L.x0, L.x1, y, y + 4, B.BOOKSHELF);
  b.wallZ(43, L.x0, L.x1, y + 5, y + 6, B.WHITE);

  /* ---- hidden vestibule behind the wall -------------------------------- */
  const V = ROOMS.VESTIBULE;
  b.plane(V.x0, V.z0, V.x1, V.z1, Y.F2_FLOOR, B.DARK_TILE);
  b.air(V.x0, y, V.z0, V.x1, y + 6, V.z1);
  b.wallZ(V.z1, V.x0, V.x1, y, y + 6, B.DARK);
  b.fill(V.x0, y + 6, V.z0, V.x1, y + 6, V.z1, B.DARK_TILE);
  b.dotsZ(V.z0, V.z1, V.x0 + 1, y + 6, 2, B.GLOWSTONE);
  screen(b, "z", V.z1, V.x0 + 1, V.x0 + 3, y + 2, y + 3, [B.SCREEN_D, B.SCREEN_C]);
}

/* ================================================================== *
 * Second floor: cinema, gaming, bar, observatory
 * ================================================================== */

function buildFloor3(b) {
  const y = Y.F3;
  interiorShellFor(b, y);

  b.wallZ(35, ROOMS.W.x0, ROOMS.W.x1, y, y + 6, B.WHITE);
  b.wallZ(33, ROOMS.E.x0, ROOMS.E.x1, y, y + 6, B.WHITE);

  /* ---- private cinema -------------------------------------------------- */
  const C = { x0: ROOMS.W.x0, x1: ROOMS.W.x1, z0: 19, z1: 34 };
  b.plane(C.x0, C.z0, C.x1, C.z1, Y.F3_FLOOR, B.BLACK);
  b.plane(C.x0 + 1, C.z0 + 1, C.x1 - 1, C.z1 - 1, Y.F3_FLOOR, B.CARPET_RED);
  // black-out the glazing behind the screen and drop the cove ring
  b.fill(C.x0, y, C.z0, C.x1, y + 6, C.z0, B.BLACK);
  b.fill(C.x0 + 1, y, C.z0 + 1, C.x1 - 1, y + 4, C.z0 + 1, B.WOOL_BLACK);
  screen(b, "z", C.z0 + 1, C.x0 + 3, C.x1 - 3, y + 1, y + 4, [
    B.SCREEN_D,
    B.SCREEN_A,
    B.SCREEN_E,
    B.SCREEN_F,
  ]);
  // three tiers of recliners, each step up one block
  for (let tier = 0; tier < 3; tier++) {
    const z = C.z0 + 5 + tier * 3;
    b.fill(C.x0 + 2, y + tier, z, C.x1 - 2, y + tier, z + 2, B.BLACK);
    for (let x = C.x0 + 3; x <= C.x1 - 3; x += 3) {
      b.set(x, y + tier + 1, z + 1, B.ST_CRIMSON, FACE.N_UP);
      b.set(x + 1, y + tier + 1, z + 1, B.ST_CRIMSON, FACE.N_UP);
      b.set(x, y + tier + 2, z + 2, B.WOOL_RED);
      b.set(x + 1, y + tier + 2, z + 2, B.WOOL_RED);
    }
  }
  // aisle strip lighting and a projection booth
  b.dotsZ(C.z0 + 4, C.z1 - 1, C.x0 + 1, Y.F3_FLOOR, 2, B.MARK_NEON);
  b.dotsZ(C.z0 + 4, C.z1 - 1, C.x1 - 1, Y.F3_FLOOR, 2, B.MARK_NEON);
  b.fill(C.x0 + 8, y + 3, C.z1 - 1, C.x0 + 11, y + 4, C.z1, B.DARK);
  b.set(C.x0 + 9, y + 4, C.z1 - 1, B.SCREEN_C);

  /* ---- gaming room ----------------------------------------------------- */
  const G = { x0: ROOMS.W.x0, x1: ROOMS.W.x1, z0: 36, z1: 48 };
  b.plane(G.x0, G.z0, G.x1, G.z1, Y.F3_FLOOR, B.BLACK);
  b.plane(G.x0 + 1, G.z0 + 1, G.x1 - 1, G.z1 - 1, Y.F3_FLOOR, B.CARPET_BLACK);
  // battlestation row facing a triple screen
  b.fill(G.x0 + 2, y, G.z0 + 2, G.x1 - 2, y, G.z0 + 3, B.DARK);
  b.fill(G.x0 + 2, y + 1, G.z0 + 3, G.x1 - 2, y + 1, G.z0 + 3, B.BLACKSTONE);
  for (let x = G.x0 + 3; x <= G.x1 - 3; x += 4) {
    b.set(x, y + 1, G.z0 + 3, B.SCREEN_C);
    b.set(x + 1, y + 1, G.z0 + 3, B.SCREEN_A);
    b.set(x, y, G.z0 + 1, B.ST_DARK, FACE.N);
  }
  screen(b, "z", G.z0, G.x0 + 3, G.x1 - 3, y + 2, y + 4, [
    B.SCREEN_H,
    B.SCREEN_F,
    B.SCREEN_B,
    B.SCREEN_G,
  ]);
  // arcade wall and a neon ceiling grid
  for (let z = G.z0 + 6; z <= G.z1 - 2; z += 3) {
    b.fill(G.x1 - 1, y, z, G.x1 - 1, y + 2, z + 1, B.BLACK);
    b.set(G.x1 - 1, y + 1, z, B.SCREEN_B);
    b.set(G.x1 - 1, y + 1, z + 1, B.SCREEN_F);
  }
  for (let x = G.x0 + 2; x <= G.x1 - 2; x += 4) {
    b.fill(x, y + 6, G.z0 + 5, x, y + 6, G.z1 - 1, B.MARK_NEON);
  }
  // lounge beanbags and a drinks fridge
  b.fill(G.x0 + 2, y, G.z1 - 4, G.x0 + 5, y, G.z1 - 2, B.WOOL_BLUE);
  b.fill(G.x0 + 3, y + 1, G.z1 - 3, G.x0 + 4, y + 1, G.z1 - 3, B.WOOL_BLUE);
  b.fill(G.x0 + 7, y, G.z1 - 3, G.x0 + 8, y + 2, G.z1 - 2, B.GLASS_BLACK);

  /* ---- sky bar --------------------------------------------------------- */
  const A = { x0: ROOMS.E.x0, x1: ROOMS.E.x1, z0: 19, z1: 32 };
  b.plane(A.x0, A.z0, A.x1, A.z1, Y.F3_FLOOR, B.DARK_TILE);
  b.fill(43, y, 24, 52, y, 25, B.BLACK);
  b.fill(43, y + 1, 24, 52, y + 1, 25, B.SMOOTH_QUARTZ);
  b.fill(43, y, 26, 52, y + 3, 26, B.GLASS_BLACK);
  b.dotsX(43, 52, 26, y + 2, 2, B.MARK_NEON);
  for (let x = 44; x <= 51; x += 2) {
    b.set(x, y, 23, B.ST_DARK, FACE.N);
    b.set(x, y + 1, 23, B.CARPET_BLACK);
  }
  b.fill(43, y + 5, 24, 52, y + 5, 25, B.GLOWSTONE);
  // lounge seating facing the glass
  sofa(b, A.x0 + 1, A.x0 + 8, 30, 30, y, FACE.N_UP, B.ST_DARK, B.CARPET_WHITE);
  sofa(b, A.x1 - 8, A.x1 - 1, 30, 30, y, FACE.N_UP, B.ST_DARK, B.CARPET_WHITE);
  b.fill(A.x0 + 4, y, 20, A.x1 - 4, y, 21, B.DARK_TILE);
  planter(b, A.x1 - 3, 30, A.x1 - 1, 32, y, B.DARK, B.AZALEA_FLOWER);

  /* ---- observatory lounge ---------------------------------------------- */
  const O = { x0: ROOMS.E.x0, x1: ROOMS.E.x1, z0: 34, z1: 48 };
  b.plane(O.x0, O.z0, O.x1, O.z1, Y.F3_FLOOR, B.DARK_TILE);
  // glass floor panel looking down the atrium side
  b.plane(O.x0 + 2, O.z0 + 2, O.x0 + 6, O.z0 + 6, Y.F3_FLOOR, B.GLASS);
  // telescope, star chart wall, low seating ring
  b.col(52, 42, y, y + 1, B.DARK);
  b.set(52, y + 2, 42, B.END_ROD);
  b.set(52, y + 2, 43, B.SCREEN_A);
  screen(b, "z", O.z1, O.x0 + 4, O.x1 - 4, y + 2, y + 4, [
    B.SCREEN_D,
    B.SCREEN_A,
    B.SCREEN_F,
  ]);
  b.disc(48, 44, 4, Y.F3_FLOOR, B.CARPET_BLUE);
  b.disc(48, 44, 4, Y.F3_FLOOR, B.MARK_NEON, 3);
  sofa(b, 45, 51, 41, 41, y, FACE.N_UP, B.ST_DARK, B.CARPET_LGRAY);
  sofa(b, 45, 51, 47, 47, y, FACE.S_UP, B.ST_DARK, B.CARPET_LGRAY);
}

/* ================================================================== *
 * Roof: deck, pergola lounge, raised helipad
 * ================================================================== */

function buildRoof(b) {
  const y = Y.ROOF;

  // Head house over the stair and lift core.
  b.fill(26, y, 40, 38, y + 5, 49, B.GLASS);
  b.air(27, y, 41, 37, y + 4, 48);
  b.plane(26, 40, 38, 49, y + 5, B.WHITE);
  b.plane(27, 41, 37, 48, y + 4, B.GLOWSTONE);
  b.outline(26, 40, 38, 49, y + 5, B.BLACK);
  b.wallZ(40, 26, 38, y, y + 5, B.WHITE);
  b.wallZ(40, 26, 38, y + 4, y + 4, B.MARK_NEON);

  // Rooftop lounge: decking, sunken fire pit, pergola, planting.
  b.plane(9, 20, 30, 40, y - 1, B.SL_WARPED);
  b.disc(20, 30, 5, y - 1, B.DARK_TILE);
  b.disc(20, 30, 2, y - 1, B.BLACK);
  b.set(20, y, 30, B.CAMPFIRE);
  sofa(b, 15, 24, 26, 26, y, FACE.N_UP, B.ST_DARK, B.CARPET_WHITE);
  sofa(b, 15, 24, 34, 34, y, FACE.S_UP, B.ST_DARK, B.CARPET_WHITE);
  for (const [px, pz] of [
    [11, 22],
    [11, 38],
    [28, 22],
    [28, 38],
  ]) {
    b.col(px, pz, y, y + 3, B.BLACK);
  }
  b.fill(11, y + 4, 22, 28, y + 4, 38, B.AIR);
  for (let x = 11; x <= 28; x += 3) b.fill(x, y + 4, 22, x, y + 4, 38, B.BLACK);
  b.dotsX(12, 27, 22, y + 3, 3, B.MARK_EXT);
  b.dotsX(12, 27, 38, y + 3, 3, B.MARK_EXT);
  planter(b, 9, 20, 12, 24, y, B.WHITE, B.AZALEA_FLOWER);
  planter(b, 27, 36, 30, 40, y, B.WHITE, B.CHERRY_LEAVES);
  // rooftop plunge spa, raised above the deck with a lit basin
  b.walls(8, 41, 15, 48, y, y + 1, B.DARK_TILE);
  b.plane(9, 42, 14, 47, y, B.MARK_EXT);
  b.fill(9, y + 1, 42, 14, y + 1, 47, B.WATER);
  b.outline(8, 41, 15, 48, y + 2, B.BLACK);

  /* Raised helipad. The pad itself sits one block above the deck on a lit
   * service bay, so retracting it reveals the bay instead of opening a hole
   * into the storey below. */
  const P = PLAN.ROOFTOP_PAD;
  b.plane(P.x0 - 1, P.z0 - 1, P.x1 + 1, P.z1 + 1, y, B.BLACK);
  b.plane(P.x0, P.z0, P.x1, P.z1, y, B.DARK);
  b.outline(P.x0, P.z0, P.x1, P.z1, y, B.MARK_EXT);
  for (let x = P.x0 + 2; x <= P.x1 - 2; x += 4) {
    b.fill(x, y, P.z0 + 2, x, y, P.z1 - 2, B.MARK_NEON);
  }
  b.plane(P.x0, P.z0, P.x1, P.z1, y + 1, B.DARK_TILE);
  b.outline(P.x0, P.z0, P.x1, P.z1, y + 1, B.MARK_HELI);
  // the H
  const hx = P.x0 + 5;
  const hz = P.z0 + 5;
  b.fill(hx, y + 1, hz, hx, y + 1, hz + 6, B.MARK_HELI);
  b.fill(hx + 5, y + 1, hz, hx + 5, y + 1, hz + 6, B.MARK_HELI);
  b.fill(hx, y + 1, hz + 3, hx + 5, y + 1, hz + 3, B.MARK_HELI);
  // approach ramp up from the deck
  b.fill(P.x0 - 2, y, P.z0 + 6, P.x0 - 1, y + 1, P.z0 + 9, B.DARK);
}

/* ================================================================== *
 * Grounds: driveway, fountain, landscaping, infinity pool, lounge
 * ================================================================== */

function buildGrounds(b) {
  const yF = Y.G_FLOOR;

  // Driveway: a broad apron from the lot edge, sweeping round the fountain.
  b.plane(24, 0, 43, 17, yF, B.BLACKSTONE);
  b.plane(8, 3, 56, 5, yF, B.BLACKSTONE);
  b.disc(PLAN.FOUNTAIN.cx, PLAN.FOUNTAIN.cz, 8, yF, B.BLACKSTONE);
  b.disc(PLAN.FOUNTAIN.cx, PLAN.FOUNTAIN.cz, 6, yF, B.MOSS);

  // Fountain: tiered basin with a lit rim.
  const F = PLAN.FOUNTAIN;
  b.disc(F.cx, F.cz, F.r, yF, B.SMOOTH_QUARTZ);
  b.disc(F.cx, F.cz, F.r, yF + 1, B.SMOOTH_QUARTZ, F.r - 1);
  b.disc(F.cx, F.cz, F.r - 1, yF, B.MARK_POOL);
  b.disc(F.cx, F.cz, F.r - 1, yF + 1, B.WATER);
  b.disc(F.cx, F.cz, 2, yF + 2, B.SMOOTH_QUARTZ);
  b.disc(F.cx, F.cz, 1, yF + 3, B.SMOOTH_QUARTZ);
  b.set(F.cx, yF + 4, F.cz, B.WATER);
  b.disc(F.cx, F.cz, F.r, yF, B.MARK_PATH, F.r - 1);

  // Path lighting along the drive and the walk to the door.
  b.dotsZ(1, 16, 23, yF, 3, B.MARK_PATH);
  b.dotsZ(1, 16, 44, yF, 3, B.MARK_PATH);
  b.dotsX(25, 42, 17, yF, 3, B.MARK_PATH);
  b.dotsZ(50, 70, 5, yF, 4, B.MARK_PATH);
  b.dotsZ(50, 70, 58, yF, 4, B.MARK_PATH);

  // Lawn, hedging and specimen trees.
  for (const [x, z] of [
    [4, 4],
    [4, 14],
    [59, 4],
    [59, 14],
    [3, 30],
    [60, 30],
    [3, 44],
    [60, 44],
  ]) {
    tree(b, x, z, Y.G, 5, B.CHERRY_LOG, B.CHERRY_LEAVES);
  }
  b.fill(1, Y.G, 1, 1, Y.G + 1, 70, B.AZALEA_LEAVES);
  b.fill(62, Y.G, 1, 62, Y.G + 1, 70, B.AZALEA_LEAVES);
  b.fill(1, Y.G, 1, 62, Y.G + 1, 1, B.AZALEA_LEAVES);
  b.fill(1, Y.G, 70, 62, Y.G + 1, 70, B.AZALEA_LEAVES);

  // Rear terrace connecting the house to the pool.
  b.plane(10, 50, 50, 53, yF, B.SMOOTH_QUARTZ);
  b.outline(10, 50, 50, 53, yF, B.DARK_TILE);

  /* Infinity pool. The deck, water and glass edge sit flush so the surface
   * reads as if it runs off into the garden. */
  const P = PLAN.POOL;
  b.plane(P.x0 - 2, P.z0 - 2, P.x1 + 2, P.z1 + 2, yF, B.SMOOTH_QUARTZ);
  b.fill(P.x0, yF - 2, P.z0, P.x1, yF, P.z1, B.AIR);
  b.plane(P.x0, P.z0, P.x1, P.z1, yF - 2, B.MARK_POOL);
  b.fill(P.x0, yF - 1, P.z0, P.x1, yF, P.z1, B.WATER);
  b.walls(P.x0 - 1, P.z0 - 1, P.x1 + 1, P.z1 + 1, yF - 2, yF, B.DARK_TILE);
  b.wallZ(P.z1 + 1, P.x0 - 1, P.x1 + 1, yF - 2, yF, B.GLASS);
  // catch channel behind the infinity edge
  b.fill(P.x0 - 1, yF - 1, P.z1 + 2, P.x1 + 1, yF, P.z1 + 3, B.AIR);
  b.plane(P.x0 - 1, P.z1 + 2, P.x1 + 1, P.z1 + 3, yF - 1, B.MARK_POOL);
  b.fill(P.x0 - 1, yF, P.z1 + 2, P.x1 + 1, yF, P.z1 + 3, B.WATER);
  // sun deck and a swim-up island
  for (let x = P.x0 + 2; x <= P.x1 - 2; x += 4) {
    b.set(x, Y.G, P.z0 - 2, B.ST_SMOOTH_QUARTZ, FACE.S_UP);
    b.set(x, Y.G + 1, P.z0 - 2, B.CARPET_WHITE);
  }
  b.disc(P.x1 - 4, P.z0 + 4, 2, yF, B.SMOOTH_QUARTZ);
  b.set(P.x1 - 4, Y.G, P.z0 + 4, B.MARK_PATH);

  /* Outdoor lounge: pergola, fire table, kitchen bar, day beds. */
  const L = PLAN.LOUNGE;
  b.plane(L.x0, L.z0, L.x1, L.z1, yF, B.SL_WARPED);
  b.outline(L.x0, L.z0, L.x1, L.z1, yF, B.DARK_TILE);
  for (const [px, pz] of [
    [L.x0 + 1, L.z0 + 1],
    [L.x0 + 1, L.z1 - 1],
    [L.x1 - 1, L.z0 + 1],
    [L.x1 - 1, L.z1 - 1],
  ]) {
    b.col(px, pz, Y.G, Y.G + 3, B.BLACK);
  }
  for (let x = L.x0 + 1; x <= L.x1 - 1; x += 3) {
    b.fill(x, Y.G + 4, L.z0 + 1, x, Y.G + 4, L.z1 - 1, B.BLACK);
  }
  b.dotsX(L.x0 + 2, L.x1 - 2, L.z0 + 1, Y.G + 3, 3, B.MARK_PATH);
  b.dotsX(L.x0 + 2, L.x1 - 2, L.z1 - 1, Y.G + 3, 3, B.MARK_PATH);
  b.disc(L.x0 + 7, L.z0 + 7, 2, yF, B.DARK_TILE);
  b.set(L.x0 + 7, Y.G, L.z0 + 7, B.CAMPFIRE);
  sofa(b, L.x0 + 3, L.x0 + 11, L.z0 + 4, L.z0 + 4, Y.G, FACE.N_UP, B.ST_DARK, B.CARPET_WHITE);
  sofa(b, L.x0 + 3, L.x0 + 11, L.z0 + 10, L.z0 + 10, Y.G, FACE.S_UP, B.ST_DARK, B.CARPET_WHITE);
  b.fill(L.x0 + 2, Y.G, L.z1 - 3, L.x1 - 2, Y.G, L.z1 - 3, B.DARK);
  b.fill(L.x0 + 2, Y.G + 1, L.z1 - 3, L.x1 - 2, Y.G + 1, L.z1 - 3, B.SMOOTH_QUARTZ);
  b.set(L.x0 + 4, Y.G + 1, L.z1 - 3, B.SMOKER);
  b.set(L.x0 + 8, Y.G + 1, L.z1 - 3, B.BARREL);

  // Reinstate the vehicle platform deck: the driveway paving above overlaps it.
  const VP = PLAN.LIFT_PAD;
  b.plane(VP.x0, VP.z0, VP.x1, VP.z1, yF, B.DARK_TILE);
  b.outline(VP.x0, VP.z0, VP.x1, VP.z1, yF, B.MARK_HELI);
  b.dotsZ(VP.z0, VP.z1, VP.x0 - 1, yF, 2, B.MARK_PATH);
  b.dotsZ(VP.z0, VP.z1, VP.x1 + 1, yF, 2, B.MARK_PATH);
  // call post for the platform, so its button has something solid to sit on
  b.col(VP.x0 - 1, VP.z0 + 2, Y.G, Y.G, B.DARK);
}

/* ================================================================== *
 * Underground garage
 * ================================================================== */

function buildGarage(b) {
  const G = PLAN.GARAGE;
  const T = PLAN.GARAGE_TUNNEL;
  const y = Y.GAR;

  b.air(G.x0, y, G.z0, G.x1, Y.GAR_CEIL - 1, G.z1);
  b.plane(G.x0, G.z0, G.x1, G.z1, Y.GAR_FLOOR, B.BLACKSTONE);
  b.plane(G.x0, G.z0, G.x1, G.z1, Y.GAR_CEIL, B.SMOOTH_STONE);
  b.walls(G.x0, G.z0, G.x1, G.z1, y, Y.GAR_CEIL - 1, B.DARK_TILE);

  /* Bright, even ceiling lighting. Froglights rather than sea lanterns: the
   * smart-lighting fills own sea lanterns everywhere else. */
  for (let x = G.x0 + 3; x <= G.x1 - 2; x += 5) {
    b.fill(x, Y.GAR_CEIL, G.z0 + 2, x, Y.GAR_CEIL, G.z1 - 2, B.FROG_PEARL);
  }
  // wall level neon runs
  b.wallZ(G.z0, G.x0 + 1, G.x1 - 1, y + 4, y + 4, B.MARK_NEON);
  b.wallZ(G.z1, G.x0 + 1, G.x1 - 1, y + 4, y + 4, B.MARK_NEON);

  // opening from the access tunnel into the parking hall
  b.air(44, y, G.z0, 49, y + 4, G.z0);

  // Vehicle access tunnel and its shaft up to the driveway pad.
  b.air(T.x0, y, T.z0, T.x1, y + 4, T.z1);
  b.plane(T.x0, T.z0, T.x1, T.z1, Y.GAR_FLOOR, B.BLACKSTONE);
  b.plane(T.x0, T.z0, T.x1, T.z1, y + 5, B.SMOOTH_STONE);
  b.walls(T.x0 - 1, T.z0, T.x1 + 1, T.z1, y, y + 4, B.DARK_TILE);
  b.dotsZ(T.z0, T.z1, T.x0 - 1, y + 3, 2, B.MARK_NEON);
  b.dotsZ(T.z0, T.z1, T.x1 + 1, y + 3, 2, B.MARK_NEON);

  const V = PLAN.LIFT_PAD;
  b.fill(V.x0 - 1, Y.GAR_FLOOR, V.z0 - 1, V.x1 + 1, Y.G_FLOOR, V.z1 + 1, B.DARK_TILE);
  b.air(V.x0, Y.GAR_FLOOR, V.z0, V.x1, Y.G_FLOOR, V.z1);
  b.plane(V.x0, V.z0, V.x1, V.z1, Y.G_FLOOR, B.DARK_TILE); // platform, parked up
  b.outline(V.x0, V.z0, V.x1, V.z1, Y.G_FLOOR, B.MARK_HELI);
  b.air(V.x0, Y.GAR_FLOOR, V.z1 + 1, V.x1, y + 4, V.z1 + 1); // opening to the tunnel

  // Bays: five marked spaces, each with a car and a charge post.
  const bays = [
    [B.RED, B.BLACK],
    [B.BLACK, B.SCREEN_C],
    [B.WHITE, B.DARK],
    [B.BLUE, B.SMOOTH_QUARTZ],
    [B.LGRAY, B.ORANGE],
  ];
  bays.forEach(([body, trim], i) => {
    const x = G.x0 + 2 + i * 7;
    b.fill(x - 1, Y.GAR_FLOOR, G.z0 + 2, x + 3, Y.GAR_FLOOR, G.z0 + 9, B.BLACK);
    b.outline(x - 1, G.z0 + 2, x + 3, G.z0 + 9, Y.GAR_FLOOR, B.MARK_HELI);
    car(b, x, G.z0 + 3, y, body, trim);
    b.col(x + 4, G.z0 + 2, y, y + 1, B.DARK);
    b.set(x + 4, y + 2, G.z0 + 2, B.SCREEN_C);
  });

  /* Workshop: benches, machines, a parts wall. */
  const W = ROOMS.WORKSHOP;
  b.walls(W.x0 - 1, W.z0 - 1, W.x1 + 1, W.z1 + 1, y, y + 5, B.DARK);
  b.air(W.x0, y, W.z0, W.x1, y + 5, W.z1);
  b.plane(W.x0, W.z0, W.x1, W.z1, Y.GAR_FLOOR, B.DARK_TILE);
  b.plane(W.x0 + 1, W.z0 + 1, W.x1 - 1, W.z1 - 1, y + 5, B.FROG_PEARL);
  b.fill(W.x0, y, W.z0, W.x0, y, W.z0 + 8, B.DARK);
  b.fill(W.x0, y + 1, W.z0, W.x0, y + 1, W.z0 + 8, B.SMOOTH_STONE);
  const machines = [B.ANVIL, B.SMITHING, B.GRINDSTONE, B.STONECUTTER, B.CRAFTING, B.LOOM, B.CARTOGRAPHY, B.FLETCHING];
  machines.forEach((m, i) => b.set(W.x0, y + 1, W.z0 + 1 + i, m));
  b.fill(W.x1, y, W.z0 + 1, W.x1, y + 3, W.z1 - 1, B.BARREL);
  b.set(W.x1 - 1, y, W.z0 + 2, B.ENCHANTING);
  b.fill(W.x0 + 2, y, W.z1 - 2, W.x0 + 4, y, W.z1 - 1, B.IRON);

  /* Storage: racking, crates, a strongbox row. */
  const S = ROOMS.STORAGE;
  b.walls(S.x0 - 1, S.z0 - 1, S.x1 + 1, S.z1 + 1, y, y + 5, B.DARK);
  b.air(S.x0, y, S.z0, S.x1, y + 5, S.z1);
  b.plane(S.x0, S.z0, S.x1, S.z1, Y.GAR_FLOOR, B.DARK_TILE);
  b.plane(S.x0 + 1, S.z0 + 1, S.x1 - 1, S.z1 - 1, y + 5, B.FROG_PEARL);
  for (let z = S.z0 + 1; z <= S.z1 - 1; z += 3) {
    b.fill(S.x0, y, z, S.x0 + 1, y + 2, z, B.BARREL);
    b.fill(S.x1 - 1, y, z, S.x1, y + 2, z, B.BARREL);
  }
  b.fill(S.x0 + 3, y, S.z1 - 1, S.x0 + 6, y, S.z1 - 1, B.CHEST);
  b.set(S.x0 + 8, y, S.z1 - 1, B.ENDER_CHEST);
}

/* ================================================================== *
 * Deep level: command centre, vault, airlock
 * ================================================================== */

function buildDeepLevel(b) {
  const y = Y.DEEP;
  const C = PLAN.COMMAND;

  b.air(C.x0, y, C.z0, C.x1, Y.DEEP_CEIL - 1, C.z1);
  b.plane(C.x0, C.z0, C.x1, C.z1, Y.DEEP_FLOOR, B.DARK_TILE);
  b.plane(C.x0, C.z0, C.x1, C.z1, Y.DEEP_CEIL, B.DARK);
  b.walls(C.x0 - 1, C.z0 - 1, C.x1 + 1, C.z1 + 1, y, Y.DEEP_CEIL - 1, B.DARK);
  b.plane(C.x0 + 2, C.z0 + 2, C.x1 - 2, C.z1 - 2, Y.DEEP_FLOOR, B.BLACK);

  // ceiling light grid (below the smart-lighting volume, so sea lanterns are safe)
  for (let x = C.x0 + 2; x <= C.x1 - 2; x += 4) {
    b.fill(x, Y.DEEP_CEIL, C.z0 + 2, x, Y.DEEP_CEIL, C.z1 - 2, B.SEA_LANTERN);
  }

  /* Video wall: a stylised world map flanked by monitor banks. */
  const mapZ = C.z1;
  b.fill(C.x0 + 1, y, mapZ, C.x1 - 1, y + 5, mapZ, B.BLACK);
  const land = [
    [26, 2, 4, 3],
    [31, 1, 3, 2],
    [30, 3, 5, 2],
    [37, 2, 4, 4],
    [42, 1, 3, 2],
    [41, 4, 4, 2],
  ];
  for (const [lx, ly, lw, lh] of land) {
    b.fill(lx, y + ly, mapZ, lx + lw - 1, y + ly + lh - 1, mapZ, B.SCREEN_G);
  }
  for (let x = C.x0 + 1; x <= C.x1 - 1; x++) {
    if ((x + 1) % 5 === 0) b.fill(x, y, mapZ, x, y + 5, mapZ, B.SCREEN_A);
  }
  b.fill(C.x0 + 1, y + 6, mapZ - 1, C.x1 - 1, y + 6, mapZ, B.SEA_LANTERN);

  /* Console horseshoe facing the video wall. The panic keys live here. */
  console3(b, C.x0 + 5, C.x1 - 5, mapZ - 2, y, FACE.S_UP);
  b.fill(C.x0 + 5, y, mapZ - 3, C.x1 - 5, y, mapZ - 3, B.BLACK);
  console3(b, C.x0 + 3, C.x0 + 8, mapZ - 6, y, FACE.S_UP);
  console3(b, C.x1 - 8, C.x1 - 3, mapZ - 6, y, FACE.S_UP);
  // labelled key blocks under the buttons placed later
  b.set(35, y, mapZ - 2, B.REDSTONE_BLOCK);
  b.set(33, y, mapZ - 2, B.EMERALD);
  b.set(37, y, mapZ - 2, B.GOLD);
  b.set(31, y, mapZ - 2, B.LAPIS);
  b.set(39, y, mapZ - 2, B.DIAMOND);

  /* Server racks and redstone plant along the side walls. */
  for (let z = C.z0 + 5; z <= C.z0 + 8; z += 3) {
    b.fill(C.x0, y, z, C.x0 + 1, y + 3, z + 1, B.BLACK);
    b.set(C.x0 + 1, y + 1, z, B.SCREEN_C);
    b.set(C.x0 + 1, y + 2, z + 1, B.SCREEN_H);
    b.fill(C.x1 - 1, y, z, C.x1, y + 3, z + 1, B.BLACK);
    b.set(C.x1 - 1, y + 1, z + 1, B.SCREEN_B);
    b.set(C.x1 - 1, y + 2, z, B.SCREEN_F);
  }
  const rig = [B.OBSERVER, B.DISPENSER, B.DROPPER, B.HOPPER, B.PISTON, B.STICKY_PISTON, B.TARGET, B.NOTE_BLOCK];
  rig.forEach((r, i) => b.set(C.x0 + 3 + i, y, C.z0 + 1, r));
  b.fill(C.x0 + 3, y + 1, C.z0 + 1, C.x0 + 10, y + 1, C.z0 + 1, B.REDSTONE_BLOCK);
  b.set(C.x0 + 1, y, C.z0 + 1, B.LODESTONE);
  // hidden tunnel trigger: an ordinary looking pot beside the hatch wall
  b.set(26, y, 30, B.FLOWER_POT);

  // Briefing table with a holographic centre.
  b.fill(31, y, 36, 39, y, 39, B.DARK);
  b.fill(32, y + 1, 37, 38, y + 1, 38, B.GLASS_CYAN);
  b.fill(34, y + 1, 37, 36, y + 1, 38, B.SCREEN_C);

  /* Lift hall linking the secure lift to the command centre. */
  const LH = PLAN.LIFT_HALL;
  b.air(LH.x0, y, LH.z0, LH.x1, y + 5, LH.z1);
  b.plane(LH.x0, LH.z0, LH.x1, LH.z1, Y.DEEP_FLOOR, B.DARK_TILE);
  b.plane(LH.x0, LH.z0, LH.x1, LH.z1, y + 6, B.DARK);
  b.walls(LH.x0 - 1, LH.z0 - 1, LH.x1 + 1, LH.z1 + 1, y, y + 5, B.DARK);
  b.dotsZ(LH.z0, LH.z1, LH.x0, y + 4, 2, B.SEA_LANTERN);

  /* Airlock between the command centre and the vault. */
  const A = PLAN.AIRLOCK;
  b.air(A.x0, y, A.z0, A.x1, y + 5, A.z1);
  b.plane(A.x0, A.z0, A.x1, A.z1, Y.DEEP_FLOOR, B.DARK_TILE);
  b.plane(A.x0, A.z0, A.x1, A.z1, y + 6, B.DARK);
  b.walls(A.x0 - 1, A.z0 - 1, A.x1 + 1, A.z1 + 1, y, y + 5, B.DARK);
  b.fill(A.x0 + 1, y + 5, A.z0 + 1, A.x1 - 1, y + 5, A.z1 - 1, B.SEA_LANTERN);
  b.set(19, y, 39, B.LODESTONE); // hidden vault trigger
  b.set(17, y, 40, B.BLACKSTONE); // plinth under the vault release button
  b.set(17, y - 1, 40, B.DARK);
  screen(b, "z", A.z0, A.x0 + 1, A.x1 - 1, y + 2, y + 3, [B.SCREEN_D, B.SCREEN_C]);
  b.fill(A.x1, y, A.z1, A.x1, y + 2, A.z1, B.BARS);

  /* Vault chamber. */
  const V = PLAN.VAULT;
  b.air(V.x0, y, V.z0, V.x1, y + 5, V.z1);
  b.plane(V.x0, V.z0, V.x1, V.z1, Y.DEEP_FLOOR, B.BLACKSTONE);
  b.plane(V.x0 + 1, V.z0 + 1, V.x1 - 1, V.z1 - 1, Y.DEEP_FLOOR, B.GOLD);
  b.plane(V.x0, V.z0, V.x1, V.z1, y + 6, B.NETHERITE);
  b.walls(V.x0 - 1, V.z0 - 1, V.x1 + 1, V.z1 + 1, y, y + 5, B.NETHERITE);
  b.fill(V.x0 + 1, y + 5, V.z0 + 1, V.x1 - 1, y + 5, V.z1 - 1, B.SEA_LANTERN);
  // armour display plinths (the stands themselves are spawned later)
  for (let i = 0; i < 4; i++) {
    const z = V.z0 + 2 + i * 3;
    b.set(V.x0 + 1, Y.DEEP_FLOOR, z, B.DARK);
    b.set(V.x0 + 1, y, z, B.BLACKSTONE);
    b.set(V.x0 + 1, y + 3, z, B.SEA_LANTERN);
  }
  // weapon and tool racks
  for (let i = 0; i < 5; i++) {
    const z = V.z0 + 2 + i * 2;
    b.set(V.x1 - 1, y, z, B.BARREL);
    b.set(V.x1 - 1, y + 1, z, B.BARS);
  }
  // bullion shelving and a display case
  b.fill(V.x0 + 3, y, V.z0 + 1, V.x0 + 6, y + 1, V.z0 + 1, B.GOLD);
  b.fill(V.x0 + 3, y, V.z1 - 1, V.x0 + 6, y + 1, V.z1 - 1, B.DIAMOND);
  b.fill(V.x0 + 4, y, V.z0 + 5, V.x0 + 6, y, V.z0 + 7, B.DARK);
  b.fill(V.x0 + 4, y + 1, V.z0 + 5, V.x0 + 6, y + 3, V.z0 + 7, B.GLASS);
  b.set(V.x0 + 5, y + 1, V.z0 + 6, B.EMERALD);
  b.fill(V.x0 + 2, y, V.z0 + 9, V.x0 + 5, y, V.z0 + 10, B.CHEST);

  /* Iris door recess between airlock and vault: the moving rings are written
   * by the security system, this just frames them. */
  b.fill(V.x1 + 1, y - 1, 36, V.x1 + 1, y + 5, 44, B.NETHERITE);
  b.fill(V.x1 + 1, y, 37, V.x1 + 1, y + 4, 43, B.NETHERITE);
  b.fill(V.x1 + 2, y, 37, V.x1 + 2, y + 4, 43, B.AIR);
  b.fill(V.x1, y, 37, V.x1, y + 4, 43, B.AIR);
}

/* ================================================================== *
 * Escape tunnel
 * ================================================================== */

function buildTunnel(b) {
  const T = PLAN.TUNNEL;
  const y = Y.DEEP;

  b.fill(T.x0 - 2, y - 1, T.z0 - 1, T.x1, y + 5, T.z1 + 1, B.DEEPSLATE);
  b.air(T.x0, y, T.z0, T.x1, y + 3, T.z1);
  b.plane(T.x0, T.z0, T.x1, T.z1, y - 1, B.DARK_TILE);
  b.plane(T.x0, T.z0, T.x1, T.z1, y + 4, B.DARK);
  b.walls(T.x0 - 1, T.z0 - 1, T.x1, T.z1 + 1, y, y + 3, B.DARK);
  // rails and cable trays for flavour
  b.fill(T.x0, y - 1, T.z0, T.x1, y - 1, T.z0, B.IRON);
  b.fill(T.x0, y - 1, T.z1, T.x1, y - 1, T.z1, B.IRON);
  // light fittings, dark until the tunnel is opened
  for (let x = T.x0 + 2; x <= T.x1 - 2; x += 5) {
    b.set(x, y + 4, T.z0 + 1, B.DARK_TILE);
    b.set(x, y + 4, T.z1 - 1, B.DARK_TILE);
  }

  /* Exit shaft: a switchback stair climbing to a rock outcrop in the trees. */
  const E = PLAN.TUNNEL_EXIT;
  b.fill(E.x0 - 1, y - 1, E.z0 - 1, E.x1 + 1, Y.G + 6, E.z1 + 1, B.STONE);
  b.air(E.x0, y, E.z0, E.x1, Y.G + 4, E.z1);
  b.plane(E.x0, E.z0, E.x1, E.z1, y - 1, B.DARK_TILE);
  b.walls(E.x0 - 1, E.z0 - 1, E.x1 + 1, E.z1 + 1, y, Y.G + 4, B.DARK);
  b.switchback(E.x0 + 1, E.x1 - 1, E.z0 + 1, E.z1 - 1, y - 1, Y.G_FLOOR, B.DARK_TILE, 4);
  b.plane(E.x0, E.z0, E.x1, E.z1, Y.G_FLOOR, B.DARK_TILE);
  b.air(E.x0 + 1, Y.G, E.z0 + 1, E.x1 - 1, Y.G + 3, E.z1 - 1);
  b.plane(E.x0, E.z0, E.x1, E.z1, Y.G + 4, B.DARK);
  for (let yy = y + 3; yy <= Y.G; yy += 4) {
    b.set(E.x0 + 1, yy, E.z0 + 1, B.SEA_LANTERN);
    b.set(E.x1 - 1, yy, E.z1 - 1, B.SEA_LANTERN);
  }

  /* Disguised surface exit: a mossy boulder with a sliding stone face. */
  b.air(E.x0 - 4, Y.G, E.z0 - 4, E.x1 + 8, Y.G + 14, E.z1 + 4);
  b.plane(E.x0 - 4, E.z0 - 4, E.x1 + 8, E.z1 + 4, Y.G_FLOOR, B.MOSS);
  // the boulder: rough stone shell, mossed over, hiding a 2x3 sliding face
  b.fill(E.x0 - 1, Y.G, E.z0 - 1, E.x1 + 3, Y.G + 4, E.z1 + 1, B.STONE);
  b.fill(E.x0, Y.G + 1, E.z0, E.x1 + 2, Y.G + 5, E.z1, B.ANDESITE);
  b.fill(E.x0 + 1, Y.G + 3, E.z0 + 1, E.x1 + 1, Y.G + 6, E.z1 - 1, B.STONE);
  b.fill(E.x0 + 2, Y.G + 5, E.z0 + 2, E.x1, Y.G + 7, E.z1 - 2, B.MOSS);
  // shaft head and the corridor out to the disguised face
  b.fill(E.x0 + 1, Y.G, E.z0 + 1, E.x1, Y.G + 3, E.z1 - 1, B.AIR);
  b.fill(E.x1 + 1, Y.G, 28, E.x1 + 2, Y.G + 2, 29, B.AIR);
  b.set(E.x1, Y.G + 3, 28, B.SEA_LANTERN);
  tree(b, E.x0 - 2, E.z0 - 2, Y.G, 5, B.MANGROVE_LOG, B.MANGROVE_LEAVES);
  tree(b, E.x1 + 6, E.z1 + 2, Y.G, 5, B.MANGROVE_LOG, B.MANGROVE_LEAVES);
}

/* ================================================================== *
 * Doors and controls
 * ================================================================== */

function placeDoors(b, spec) {
  const o = spec.origin;
  for (const door of spec.doors) {
    const x = door.x - o.x;
    const y = door.y - o.y;
    const z = door.z - o.z;
    const x1 = door.axis === "x" ? x + door.width - 1 : x;
    const z1 = door.axis === "z" ? z + door.width - 1 : z;
    // clear the reveal, then seal it with the closed door panel
    b.fill(x, y, z, x1, y + door.height - 1, z1, B.AIR);
    b.fill(x, y, z, x1, y + door.height - 1, z1, door.block);
    // head frame above every opening
    const hy = y + door.height;
    b.fill(x, hy, z, x1, hy, z1, door.sound === "heavy" ? B.DARK : B.BLACK);

    /* Furniture placed earlier does not know where the doorways ended up, so
     * clear one block of standing room on each face. Without this a vanity or
     * a bookcase can end up parked against a door that then opens onto it. */
    const dx = door.axis === "z" ? 1 : 0;
    const dz = door.axis === "x" ? 1 : 0;
    for (const side of [-1, 1]) {
      b.air(
        x + dx * side,
        y,
        z + dz * side,
        x1 + dx * side,
        y + door.height - 1,
        z1 + dz * side
      );
    }
  }
}

function placeControls(b, spec) {
  const o = spec.origin;
  for (const btn of spec.buttons) {
    b.set(btn.x - o.x, btn.y - o.y, btn.z - o.z, B.BUTTON, btn.states);
  }
  // the panic key gets a red button and a warning surround
  const panic = spec.buttons.find((x) => x.action === "lockdown_toggle");
  if (panic) {
    b.set(panic.x - o.x, panic.y - o.y, panic.z - o.z, B.BUTTON_RED, panic.states);
  }
}

/* ================================================================== *
 * Entry point
 * ================================================================== */

export function emitBuild(spec, b) {
  /* Order matters. The basements are carved before the superstructure so the
   * lift shafts, which are threaded through both, are never re-filled by a
   * later excavation; doors are cut last so every opening survives. */
  prepareSite(b);
  buildGarage(b);
  buildDeepLevel(b);
  buildTunnel(b);
  buildShell(b);
  buildGroundFloor(b);
  buildFloor2(b);
  buildFloor3(b);
  buildRoof(b);
  buildCirculation(b);
  buildGrounds(b);
  placeDoors(b, spec);
  placeControls(b, spec);
}

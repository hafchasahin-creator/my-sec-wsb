/*
 * Daybreak - structure blueprints.
 *
 * Each blueprint is a plain list of operations in local coordinates; the
 * builder translates and paces them. Blueprints are written procedurally
 * rather than stored as .mcstructure files so they stay readable, edit-able
 * and tiny in the download.
 *
 * Local axes: +X runs along the main corridor, +Y is up, +Z is "north side".
 * Y = 0 is always the floor the player walks on.
 */

const NS = "daybreak";

/* ------------------------------------------------------------- primitives */

const fill = (ops, x1, y1, z1, x2, y2, z2, block) =>
  ops.push({ f: [x1, y1, z1, x2, y2, z2, block] });
const set = (ops, x, y, z, block) => ops.push({ s: [x, y, z, block] });
const chest = (ops, x, y, z, loot) => ops.push({ c: [x, y, z, loot] });
const sign = (ops, x, y, z, text) => ops.push({ g: [x, y, z, text] });
const mob = (ops, x, y, z, id) => ops.push({ e: [x, y, z, id] });

/** Solid shell with a hollow inside. */
function shell(ops, x1, y1, z1, x2, y2, z2, wall, inner = "air") {
  fill(ops, x1, y1, z1, x2, y2, z2, wall);
  fill(ops, x1 + 1, y1 + 1, z1 + 1, x2 - 1, y2 - 1, z2 - 1, inner);
}

/**
 * A climbable vertical shaft.
 *
 * The ladder column sits inside a solid tower rather than against one wall,
 * because a ladder placed by /setblock keeps whichever face it can attach to -
 * and surrounded by stone on every side, there is always one. This is why the
 * shafts are towers and not open holes.
 */
function shaft(ops, x, z, fromY, toY, block) {
  fill(ops, x - 1, fromY, z - 1, x + 1, toY + 1, z + 1, block);
  fill(ops, x, fromY, z, x, toY, z, "ladder");
}

/** Scatter of decay: cobwebs, rubble and a cracked floor. */
function decay(ops, x1, z1, x2, z2, amount) {
  for (let index = 0; index < amount; index++) {
    const x = x1 + Math.floor(Math.random() * Math.max(1, x2 - x1));
    const z = z1 + Math.floor(Math.random() * Math.max(1, z2 - z1));
    const roll = Math.random();
    if (roll < 0.4) set(ops, x, 1, z, "web");
    else if (roll < 0.7) set(ops, x, 1, z, "gravel");
    else set(ops, x, 0, z, "cracked_stone_bricks");
  }
}

/* ============================================================== FACILITY */

const FACILITY_ROOMS = [
  {
    x: 2, side: 1, name: "SECURITY CHECKPOINT", door: `${NS}:security_door`,
    sign: ["SITE ENTRY", "PRESENT CARD", "LEVEL 1+", "NO EXCEPTIONS"],
    loot: "daybreak_military", mobs: [`${NS}:melted_survivor`],
  },
  {
    x: 2, side: -1, name: "SURVEILLANCE", door: `${NS}:security_door`,
    sign: ["CAMERA WALL", "EXTERIOR FEEDS", "ALL FEEDS WHITE", "SINCE 06:14"],
    loot: "daybreak_facility", mobs: [], survivor: `${NS}:survivor_scientist`,
  },
  {
    x: 15, side: 1, name: "LABORATORY ALPHA", door: `${NS}:lab_door`, clean: true,
    sign: ["LAB ALPHA", "SOLAR SAMPLES", "DO NOT UNSEAL", "IN DAYLIGHT"],
    loot: "daybreak_lab", mobs: [`${NS}:crawling_melt`], contamination: true,
  },
  {
    x: 15, side: -1, name: "LABORATORY BETA", door: `${NS}:lab_door`, clean: true,
    sign: ["LAB BETA", "TISSUE STUDY", "SUBJECTS REMAIN", "MOBILE"],
    loot: "daybreak_lab", mobs: [`${NS}:crawling_melt`, `${NS}:crawling_melt`],
  },
  {
    x: 28, side: 1, name: "CONTAINMENT", door: `${NS}:blast_door`,
    sign: ["CONTAINMENT", "LEVEL 4 ONLY", "OCCUPANT WAS", "STAFF ONCE"],
    loot: "daybreak_facility", mobs: [`${NS}:flesh_mass`], contamination: true,
  },
  {
    x: 28, side: -1, name: "MEDICAL WING", door: `${NS}:lab_door`, clean: true,
    sign: ["MEDICAL", "BURN TRIAGE", "SHADE SLOWS IT", "NOTHING STOPS IT"],
    loot: "daybreak_medical", mobs: [], survivor: `${NS}:survivor_medic`,
  },
  {
    x: 41, side: 1, name: "ARMOURY", door: `${NS}:blast_door`,
    sign: ["ARMOURY", "LEVEL 4 ONLY", "FLARES DRAW THEM", "USE TO RUN"],
    loot: "daybreak_military", mobs: [], survivor: `${NS}:survivor_guard`,
  },
  {
    x: 41, side: -1, name: "OFFICES", door: `${NS}:security_door`,
    sign: ["ADMIN", "EVAC ORDER", "SIGNED 06:20", "NOBODY LEFT"],
    loot: "daybreak_facility", mobs: [`${NS}:mimic_survivor`],
  },
  {
    x: 54, side: 1, name: "GENERATOR", door: `${NS}:security_door`,
    sign: ["GENERATOR", "SITE POWER", "RUNNING ON", "RESERVE"],
    loot: "daybreak_facility", mobs: [`${NS}:melted_survivor`], alarm: true,
  },
  {
    x: 54, side: -1, name: "CAFETERIA", door: `${NS}:security_door`,
    sign: ["CAFETERIA", "RATION LIMIT", "ONE PER SHIFT", "SHIFTS ENDED"],
    loot: "daybreak_town", mobs: [], survivor: `${NS}:survivor_civilian`,
  },
];

function facilityRoom(ops, spec) {
  const { x, side } = spec;
  const x1 = x;
  const x2 = x + 11;
  const near = side > 0 ? 4 : -15;
  const far = side > 0 ? 15 : -4;
  const wall = spec.clean ? "quartz_block" : "stone_bricks";

  shell(ops, x1, 0, near, x2, 5, far, wall);
  fill(ops, x1 + 1, 0, near + 1, x2 - 1, 0, far - 1, "smooth_stone");

  // Doorway through both the room wall and the corridor wall.
  const doorX = x + 5;
  const outerZ = side > 0 ? 4 : -4;
  const innerZ = side > 0 ? 3 : -3;
  fill(ops, doorX, 1, outerZ, doorX + 1, 3, outerZ, "air");
  fill(ops, doorX, 1, innerZ, doorX + 1, 3, innerZ, spec.door);

  // Lighting, then let it rot.
  const midZ = side > 0 ? 9 : -9;
  set(ops, x + 3, 4, midZ, "sea_lantern");
  set(ops, x + 8, 4, midZ, "sea_lantern");
  decay(ops, x1 + 1, Math.min(near, far) + 1, x2 - 1, Math.max(near, far) - 1, 10);

  sign(ops, x + 2, 1, midZ + side * 3, spec.sign.join("\n"));
  chest(ops, x + 7, 1, midZ, spec.loot);
  if (spec.loot === "daybreak_facility") chest(ops, x + 8, 1, midZ + side, "daybreak_lab");

  for (const id of spec.mobs ?? []) mob(ops, x + 4, 1, midZ, id);
  if (spec.survivor) mob(ops, x + 9, 1, midZ - side, spec.survivor);
  if (spec.contamination) mob(ops, x + 5, 1, midZ, `${NS}:contamination_marker`);
  if (spec.alarm) mob(ops, x + 5, 2, midZ, `${NS}:alarm_marker`);
}

export function facility(depth = 34) {
  const ops = [];

  // Main corridor.
  shell(ops, -2, 0, -3, 66, 5, 3, "stone_bricks");
  fill(ops, -1, 0, -2, 65, 0, 2, "smooth_stone");
  for (let x = 2; x < 65; x += 6) set(ops, x, 4, 0, "sea_lantern");
  decay(ops, 0, -2, 64, 2, 26);

  // Entry shaft up to daylight, sealed at the top by a blast door. Its height
  // is the depth the site was placed at, so the top lands at the surface.
  const top = Math.max(6, depth);
  shaft(ops, -4, 0, 1, top, "stone_bricks");
  fill(ops, -3, 1, 0, -2, 3, 0, "air"); // through into the corridor
  set(ops, -4, top + 1, 0, `${NS}:blast_door`);
  sign(ops, -1, 1, 2, ["SURFACE ACCESS", "DO NOT OPEN", "IN DAYLIGHT", "EVER"].join("\n"));

  for (const spec of FACILITY_ROOMS) facilityRoom(ops, spec);

  // Maintenance tunnels one level down, reached by a shaft near the middle.
  shell(ops, 8, -7, -2, 50, -2, 2, "deepslate_bricks");
  fill(ops, 9, -7, -1, 49, -7, 1, "polished_deepslate");
  shaft(ops, 30, 0, -6, 0, "deepslate_bricks");
  fill(ops, 30, 1, 0, 30, 1, 0, "air"); // step-in from the corridor floor
  for (let x = 12; x < 50; x += 9) set(ops, x, -3, 0, "glowstone");
  chest(ops, 20, -6, 0, "daybreak_bunker");
  chest(ops, 44, -6, 0, "daybreak_facility");
  mob(ops, 36, -6, 0, `${NS}:crawling_melt`);
  mob(ops, 16, -6, 0, `${NS}:crawling_melt`);
  sign(ops, 12, -6, 1, ["MAINTENANCE", "RUNS UNDER", "THE WHOLE SITE", "STAY DOWN HERE"].join("\n"));

  // Emergency bunker at the far end, behind a bunker door.
  shell(ops, 66, 0, -8, 80, 6, 8, "deepslate_bricks");
  fill(ops, 67, 0, -7, 79, 0, 7, "smooth_stone");
  fill(ops, 66, 1, -1, 66, 3, 1, `${NS}:bunker_door`);
  set(ops, 72, 5, 0, "sea_lantern");
  set(ops, 76, 5, 4, "sea_lantern");
  set(ops, 76, 5, -4, "sea_lantern");
  chest(ops, 78, 1, 0, "daybreak_bunker");
  chest(ops, 78, 1, 2, "daybreak_medical");
  chest(ops, 78, 1, -2, "daybreak_facility");
  set(ops, 70, 1, 5, "crafting_table");
  set(ops, 71, 1, 5, "furnace");
  set(ops, 70, 1, -5, "barrel");
  mob(ops, 74, 1, 0, `${NS}:survivor_engineer`);
  mob(ops, 74, 1, 3, `${NS}:survivor_civilian`);
  sign(ops, 68, 1, 3, ["EMERGENCY", "BUNKER", "SEALED FROM", "THE INSIDE"].join("\n"));
  sign(ops, 68, 1, -3, ["THE SUN DID", "NOT CHANGE.", "WHAT IT DOES", "TO US DID."].join("\n"));

  return ops;
}

/* =============================================================== SMALLER */

export function bunker(depth = 26) {
  const ops = [];
  shell(ops, -7, 0, -7, 7, 6, 7, "deepslate_bricks");
  fill(ops, -6, 0, -6, 6, 0, 6, "smooth_stone");
  fill(ops, 7, 1, -1, 7, 3, 1, `${NS}:bunker_door`);
  shaft(ops, 0, 0, 1, Math.max(6, depth), "deepslate_bricks");
  set(ops, -4, 5, 0, "sea_lantern");
  set(ops, 4, 5, 4, "sea_lantern");
  chest(ops, -6, 1, 3, "daybreak_bunker");
  chest(ops, -6, 1, 1, "daybreak_town");
  set(ops, -6, 1, -2, "crafting_table");
  set(ops, -5, 1, -2, "furnace");
  set(ops, -4, 1, -2, "barrel");
  sign(ops, -6, 1, 5, ["PRIVATE BUNKER", "AIR IS FINE", "LIGHT IS NOT", "STAY SEALED"].join("\n"));
  mob(ops, 3, 1, 3, `${NS}:survivor_civilian`);
  return ops;
}

export function shelter() {
  const ops = [];
  shell(ops, -4, 0, -4, 4, 4, 4, "stone_bricks");
  fill(ops, -3, 0, -3, 3, 0, 3, "smooth_stone");
  fill(ops, 4, 1, 0, 4, 3, 0, `${NS}:security_door`);
  set(ops, 0, 3, 0, "sea_lantern");
  chest(ops, -3, 1, -3, "daybreak_camp");
  set(ops, -3, 1, 3, "barrel");
  sign(ops, -3, 1, 0, ["EMERGENCY", "SHELTER 12", "CAPACITY 4", "GLASS IS NOT", ].join("\n"));
  decay(ops, -3, -3, 3, 3, 5);
  return ops;
}

export function town() {
  const ops = [];
  const plots = [
    { x: -18, z: -16, w: 11, d: 10, ruined: 0.9 },
    { x: 4, z: -18, w: 13, d: 11, ruined: 0.5 },
    { x: -16, z: 6, w: 12, d: 12, ruined: 0.7 },
    { x: 8, z: 8, w: 10, d: 10, ruined: 0.3 },
  ];
  for (const [index, plot] of plots.entries()) {
    const { x, z, w, d } = plot;
    const height = 4 + (index % 2) * 2;
    shell(ops, x, 0, z, x + w, height, z + d, "cobblestone");
    fill(ops, x + 1, 0, z + 1, x + w - 1, 0, z + d - 1, "stone");
    // Collapsed roof and blown-out windows.
    fill(ops, x + 2, height, z + 2, x + w - 2, height, z + d - 2, "air");
    fill(ops, x + 3, 2, z, x + 4, 3, z, "air");
    fill(ops, x + w, 2, z + 3, x + w, 3, z + 4, "glass_pane");
    fill(ops, x + 3, 1, z, x + 4, 1, z, "air");
    decay(ops, x + 1, z + 1, x + w - 1, z + d - 1, 14);
    chest(ops, x + 2, 1, z + d - 2, index % 2 ? "daybreak_town" : "daybreak_medical");
    if (index === 0) mob(ops, x + 5, 1, z + 5, `${NS}:flesh_mass`);
    if (index === 1) mob(ops, x + 5, 1, z + 5, `${NS}:mimic_survivor`);
    if (index === 2) mob(ops, x + 4, 1, z + 4, `${NS}:melted_survivor`);
    if (index === 3) mob(ops, x + 4, 1, z + 4, `${NS}:survivor_civilian`);
  }
  // Street furniture and a warning nailed to a post.
  fill(ops, -2, 0, -20, 1, 0, 20, "stone");
  fill(ops, -20, 0, -2, 20, 0, 1, "stone");
  sign(ops, 0, 1, 0, ["EVACUATION", "ROUTE CLOSED", "SHELTER IN", "PLACE"].join("\n"));
  mob(ops, 2, 1, 2, `${NS}:crawling_melt`);
  mob(ops, -3, 1, 3, `${NS}:crawling_melt`);
  return ops;
}

export function checkpoint() {
  const ops = [];
  // Road block and sandbag line.
  fill(ops, -12, 0, -1, 12, 0, 2, "stone");
  fill(ops, -10, 1, 0, 10, 2, 0, "cobblestone");
  fill(ops, -3, 1, 0, 3, 2, 0, "air");
  fill(ops, -3, 1, 0, 3, 2, 0, "iron_bars");
  // Guard booth.
  shell(ops, 4, 0, 3, 10, 4, 9, "stone_bricks");
  fill(ops, 5, 0, 4, 9, 0, 8, "smooth_stone");
  fill(ops, 6, 1, 3, 7, 2, 3, `${NS}:security_door`);
  fill(ops, 4, 2, 5, 4, 3, 7, "glass_pane");
  set(ops, 7, 3, 6, "sea_lantern");
  chest(ops, 8, 1, 7, "daybreak_military");
  sign(ops, 5, 1, 7, ["CHECKPOINT 7", "TURN BACK", "NO SURFACE", "MOVEMENT"].join("\n"));
  // Watchtower.
  shell(ops, -10, 0, 4, -5, 9, 9, "stone_bricks");
  fill(ops, -9, 0, 5, -6, 0, 8, "smooth_stone");
  fill(ops, -9, 8, 5, -6, 8, 8, "air");
  for (let y = 1; y <= 8; y++) set(ops, -9, y, 5, "ladder");
  chest(ops, -6, 9, 8, "daybreak_military");
  mob(ops, -7, 9, 7, `${NS}:survivor_guard`);
  mob(ops, 0, 1, 6, `${NS}:melted_survivor`);
  decay(ops, -10, -1, 10, 8, 16);
  return ops;
}

export function hospital() {
  const ops = [];
  shell(ops, -12, 0, -8, 12, 6, 8, "quartz_block");
  fill(ops, -11, 0, -7, 11, 0, 7, "smooth_stone");
  // Ward partitions.
  for (const x of [-6, 0, 6]) fill(ops, x, 1, -7, x, 4, 2, "quartz_block");
  fill(ops, -12, 1, -1, -12, 3, 1, `${NS}:lab_door`);
  fill(ops, 12, 1, -1, 12, 3, 1, "air");
  for (let x = -9; x <= 9; x += 6) set(ops, x, 5, 4, "sea_lantern");
  chest(ops, -10, 1, -6, "daybreak_medical");
  chest(ops, -4, 1, -6, "daybreak_medical");
  chest(ops, 8, 1, 6, "daybreak_lab");
  set(ops, 2, 1, 6, "brewing_stand");
  set(ops, 3, 1, 6, "cauldron");
  sign(ops, -11, 1, 3, ["TRIAGE", "BURNS ARRIVE", "ALREADY", "CHANGING"].join("\n"));
  sign(ops, 10, 1, -6, ["MORGUE", "DO NOT", "UNCOVER", "ANY OF THEM"].join("\n"));
  mob(ops, -8, 1, 3, `${NS}:melted_survivor`);
  mob(ops, 5, 1, -4, `${NS}:crawling_melt`);
  mob(ops, 9, 1, 2, `${NS}:survivor_medic`);
  mob(ops, 0, 1, 0, `${NS}:contamination_marker`);
  decay(ops, -11, -7, 11, 7, 24);
  return ops;
}

export function camp() {
  const ops = [];
  // Low blast wall around a fire.
  fill(ops, -9, 0, -9, 9, 0, 9, "stone");
  fill(ops, -9, 1, -9, 9, 2, -9, "cobblestone");
  fill(ops, -9, 1, 9, 9, 2, 9, "cobblestone");
  fill(ops, -9, 1, -9, -9, 2, 9, "cobblestone");
  fill(ops, 9, 1, -9, 9, 2, 9, "cobblestone");
  fill(ops, -1, 1, 9, 1, 2, 9, "air");
  fill(ops, -1, 0, -1, 1, 0, 1, "cobblestone");
  set(ops, 0, 1, 0, "campfire");
  // Three lean-to shelters.
  for (const [x, z] of [[-6, -6], [5, -6], [-6, 5]]) {
    shell(ops, x, 0, z, x + 4, 3, z + 4, "stone_bricks");
    fill(ops, x + 1, 0, z + 1, x + 3, 0, z + 3, "smooth_stone");
    fill(ops, x + 2, 1, z + 4, x + 2, 2, z + 4, "air");
    set(ops, x + 2, 3, z + 2, "sea_lantern");
    chest(ops, x + 1, 1, z + 1, "daybreak_camp");
  }
  mob(ops, 4, 1, 4, `${NS}:survivor_civilian`);
  mob(ops, 5, 1, 3, `${NS}:survivor_engineer`);
  mob(ops, -4, 1, 3, `${NS}:survivor_medic`);
  sign(ops, 2, 1, 0, ["WE MOVE AT", "FULL DARK", "COUNT HEADS", "BEFORE DAWN"].join("\n"));
  return ops;
}

export function laboratory(depth = 26) {
  const ops = [];
  shell(ops, -10, 0, -10, 10, 5, 10, "quartz_block");
  fill(ops, -9, 0, -9, 9, 0, 9, "smooth_stone");
  // Inner containment cube with a glass wall.
  shell(ops, -3, 0, -3, 3, 4, 3, "iron_block");
  fill(ops, -2, 1, -3, 2, 3, -3, "glass");
  fill(ops, -1, 1, 3, 0, 3, 3, `${NS}:lab_door`);
  fill(ops, 0, 1, -10, 1, 3, -10, `${NS}:lab_door`);
  shaft(ops, 0, 8, 1, Math.max(6, depth), "deepslate_bricks");
  set(ops, -6, 4, -6, "sea_lantern");
  set(ops, 6, 4, 6, "sea_lantern");
  set(ops, -6, 4, 6, "sea_lantern");
  chest(ops, -8, 1, -8, "daybreak_lab");
  chest(ops, 8, 1, 8, "daybreak_facility");
  set(ops, 7, 1, -7, "brewing_stand");
  set(ops, 6, 1, -7, "cauldron");
  set(ops, -7, 1, 7, "bookshelf");
  sign(ops, -8, 1, 0, ["SUBLEVEL LAB", "SAMPLE HELD", "UNDER GLASS", "GLASS FAILED"].join("\n"));
  mob(ops, 0, 1, 0, `${NS}:flesh_assimilator`);
  mob(ops, 0, 1, 1, `${NS}:contamination_marker`);
  mob(ops, 6, 1, -3, `${NS}:crawling_melt`);
  decay(ops, -9, -9, 9, 9, 18);
  return ops;
}

export function highway() {
  const ops = [];
  // Raised roadway with a collapsed span.
  for (let x = -24; x <= 24; x++) {
    if (x > -4 && x < 6) continue; // the gap
    fill(ops, x, 0, -4, x, 0, 4, "stone");
    fill(ops, x, 1, -5, x, 2, -5, "cobblestone");
    fill(ops, x, 1, 5, x, 2, 5, "cobblestone");
    if (x % 8 === 0) {
      fill(ops, x, -6, -4, x, -1, -4, "stone_bricks");
      fill(ops, x, -6, 4, x, -1, 4, "stone_bricks");
    }
  }
  // Rubble in the gap.
  fill(ops, -4, -3, -4, 6, -1, 4, "gravel");
  decay(ops, -20, -4, 20, 4, 26);
  // Checkpoint booth and abandoned vehicles.
  shell(ops, 10, 0, 6, 16, 4, 12, "stone_bricks");
  fill(ops, 11, 0, 7, 15, 0, 11, "smooth_stone");
  fill(ops, 12, 1, 6, 13, 2, 6, `${NS}:security_door`);
  set(ops, 13, 3, 9, "sea_lantern");
  chest(ops, 14, 1, 10, "daybreak_military");
  for (const [x, z] of [[-14, -1], [-8, 2], [12, -2], [18, 1]]) {
    fill(ops, x, 1, z, x + 2, 2, z + 1, "iron_block");
    set(ops, x + 1, 3, z, "glass_pane");
  }
  sign(ops, -20, 1, 3, ["HIGHWAY 9", "SPAN DOWN", "NO CROSSING", "IN DAYLIGHT"].join("\n"));
  mob(ops, -10, 1, 0, `${NS}:melted_survivor`);
  mob(ops, 14, 1, 0, `${NS}:crawling_melt`);
  mob(ops, 12, 1, 9, `${NS}:survivor_guard`);
  return ops;
}

export function village() {
  const ops = [];
  const huts = [[-14, -12], [2, -14], [-12, 4], [6, 6], [-2, -2]];
  for (const [index, [x, z]] of huts.entries()) {
    shell(ops, x, 0, z, x + 7, 4, z + 7, index % 2 ? "cobblestone" : "stone_bricks");
    fill(ops, x + 1, 0, z + 1, x + 6, 0, z + 6, "stone");
    fill(ops, x + 3, 1, z, x + 4, 2, z, "air");
    fill(ops, x + 2, 4, z + 2, x + 5, 4, z + 5, "air");
    decay(ops, x + 1, z + 1, x + 6, z + 6, 12);
    if (index % 2 === 0) chest(ops, x + 5, 1, z + 5, "daybreak_town");
    mob(ops, x + 3, 1, z + 3, index % 2 ? `${NS}:crawling_melt` : `${NS}:melted_survivor`);
    mob(ops, x + 4, 1, z + 4, `${NS}:contamination_marker`);
  }
  fill(ops, -4, 0, -4, -1, 0, -1, "gravel");
  set(ops, -3, 1, -3, "cauldron");
  mob(ops, 0, 1, 0, `${NS}:flesh_assimilator`);
  mob(ops, -6, 1, 8, `${NS}:mimic_survivor`);
  sign(ops, -2, 1, 2, ["QUARANTINE", "WHOLE VALLEY", "NOTHING HERE", "IS PEOPLE NOW"].join("\n"));
  return ops;
}

export const BLUEPRINTS = {
  facility: { build: facility, label: "SCP research facility", depth: 34, wide: true },
  bunker: { build: bunker, label: "underground bunker", depth: 26 },
  laboratory: { build: laboratory, label: "underground laboratory", depth: 26 },
  shelter: { build: shelter, label: "emergency shelter", depth: 0 },
  town: { build: town, label: "ruined town", depth: 0 },
  checkpoint: { build: checkpoint, label: "military checkpoint", depth: 0 },
  hospital: { build: hospital, label: "abandoned hospital", depth: 0 },
  camp: { build: camp, label: "survivor camp", depth: 0 },
  highway: { build: highway, label: "collapsed highway checkpoint", depth: 0 },
  village: { build: village, label: "contaminated village", depth: 0 },
};

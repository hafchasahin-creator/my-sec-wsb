/*
 * Luxury Tech House - the estate specification.
 *
 * This module is pure description: given a build origin it returns every
 * runtime feature of the mansion (doors, lifts, lighting zones, buttons,
 * hidden triggers, teleport targets) in absolute world coordinates.
 *
 * Nothing here touches the world. That matters because the same function runs
 * twice: once when the mansion is built, and once on every world load to
 * re-attach the smart-home systems to a mansion that already exists. Only the
 * origin has to be persisted.
 */

import { B, Y, PLAN } from "./config.js";

/* ------------------------------------------------------------------ *
 * Interior tiling. Wings run west (x 7..25), centre (x 27..37) and
 * east (x 39..56); partition walls sit on x=26 and x=38.
 * ------------------------------------------------------------------ */

export const ROOMS = {
  W: { x0: 7, x1: 25 },
  C: { x0: 27, x1: 37 },
  E: { x0: 39, x1: 56 },

  // ground floor
  LIVING: { z0: 19, z1: 32 },
  AQUARIUM: { z0: 34, z1: 38 },
  INDOOR_POOL: { z0: 40, z1: 48 },
  FOYER: { z0: 19, z1: 27 },
  KITCHEN: { z0: 19, z1: 29 },
  DINING: { z0: 31, z1: 40 },
  GUEST_BATH: { x0: 39, x1: 44, z0: 42, z1: 48 },
  GYM: { x0: 46, x1: 56, z0: 42, z1: 48 },

  // first floor
  MASTER: { z0: 19, z1: 32 },
  MASTER_BATH: { z0: 34, z1: 40 },
  OFFICE: { z0: 42, z1: 48 },
  BED2: { x0: 39, x1: 47, z0: 19, z1: 28 },
  BED3: { x0: 49, x1: 56, z0: 19, z1: 28 },
  CORRIDOR2: { z0: 30, z1: 33 },
  BATH2: { x0: 39, x1: 46, z0: 35, z1: 48 },
  LIBRARY: { x0: 48, x1: 56, z0: 35, z1: 42 },
  VESTIBULE: { x0: 48, x1: 56, z0: 44, z1: 48 },

  // second floor
  CINEMA: { z0: 19, z1: 34 },
  GAMING: { z0: 36, z1: 48 },
  BAR: { z0: 19, z1: 32 },
  OBSERVATORY: { z0: 34, z1: 48 },

  // underground
  WORKSHOP: { x0: 46, x1: 53, z0: 32, z1: 46 },
  STORAGE: { x0: 10, x1: 20, z0: 36, z1: 46 },
};

/* ------------------------------------------------------------------ *
 * Doors
 *
 * Coordinates are the minimum corner of the doorway opening. `axis` is the
 * axis the opening spans; the door is one block thick on the other axis.
 * ------------------------------------------------------------------ */

const GLASS_DOOR = { block: B.GLASS_CYAN, pane: B.PANE_CYAN, sound: "soft" };
const INNER_DOOR = { block: B.GLASS_WHITE, pane: B.PANE_WHITE, sound: "soft" };
const STEEL_DOOR = { block: B.IRON, pane: B.BARS, sound: "heavy" };
const VAULT_DOOR = { block: B.NETHERITE, pane: B.BARS, sound: "heavy" };
const SHELF_DOOR = { block: B.BOOKSHELF, pane: B.BOOKSHELF, sound: "heavy" };
const ROCK_DOOR = { block: B.STONE, pane: B.STONE, sound: "heavy" };

function relativeDoors() {
  const d = [];
  const push = (id, spec) => d.push({ id, auto: true, split: true, ...spec });

  // ---- ground floor ---------------------------------------------------
  push("main_entrance", {
    ...GLASS_DOOR,
    x: 30,
    y: Y.G,
    z: PLAN.HOUSE.z0,
    axis: "x",
    width: 4,
    height: 3,
    lockable: true,
    range: 4.2,
    label: "Main entrance",
  });
  push("rear_terrace", {
    ...GLASS_DOOR,
    x: 30,
    y: Y.G,
    z: PLAN.HOUSE.z1,
    axis: "x",
    width: 4,
    height: 3,
    lockable: true,
    range: 4.2,
    label: "Terrace doors",
  });
  push("living", { ...INNER_DOOR, x: 26, y: Y.G, z: 22, axis: "z", width: 2, height: 3 });
  push("kitchen", { ...INNER_DOOR, x: 38, y: Y.G, z: 23, axis: "z", width: 2, height: 3 });
  push("dining", { ...INNER_DOOR, x: 38, y: Y.G, z: 34, axis: "z", width: 2, height: 3 });
  push("aquarium", { ...INNER_DOOR, x: 15, y: Y.G, z: 33, axis: "x", width: 2, height: 3 });
  push("indoor_pool", { ...INNER_DOOR, x: 15, y: Y.G, z: 39, axis: "x", width: 2, height: 3 });
  push("guest_bath", { ...INNER_DOOR, x: 41, y: Y.G, z: 41, axis: "x", width: 2, height: 3 });
  push("gym", { ...INNER_DOOR, x: 50, y: Y.G, z: 41, axis: "x", width: 2, height: 3 });

  // ---- first floor ----------------------------------------------------
  push("master", { ...INNER_DOOR, x: 26, y: Y.F2, z: 22, axis: "z", width: 2, height: 3 });
  push("master_bath", { ...INNER_DOOR, x: 14, y: Y.F2, z: 33, axis: "x", width: 2, height: 3 });
  push("office", { ...INNER_DOOR, x: 14, y: Y.F2, z: 41, axis: "x", width: 2, height: 3 });
  push("bedroom_2", { ...INNER_DOOR, x: 42, y: Y.F2, z: 29, axis: "x", width: 2, height: 3 });
  push("bedroom_3", { ...INNER_DOOR, x: 52, y: Y.F2, z: 29, axis: "x", width: 2, height: 3 });
  push("bathroom_2", { ...INNER_DOOR, x: 42, y: Y.F2, z: 34, axis: "x", width: 2, height: 3 });
  push("library", { ...INNER_DOOR, x: 51, y: Y.F2, z: 34, axis: "x", width: 2, height: 3 });

  // ---- second floor ---------------------------------------------------
  push("cinema", { ...INNER_DOOR, x: 26, y: Y.F3, z: 22, axis: "z", width: 2, height: 3 });
  push("gaming", { ...INNER_DOOR, x: 15, y: Y.F3, z: 35, axis: "x", width: 2, height: 3 });
  push("bar", { ...INNER_DOOR, x: 38, y: Y.F3, z: 24, axis: "z", width: 2, height: 3 });
  push("observatory", { ...INNER_DOOR, x: 46, y: Y.F3, z: 33, axis: "x", width: 2, height: 3 });

  // ---- roof -----------------------------------------------------------
  push("roof_head", {
    ...GLASS_DOOR,
    x: 31,
    y: Y.ROOF,
    z: 40,
    axis: "x",
    width: 2,
    height: 3,
    label: "Roof access",
  });

  // ---- glass elevator: one door per stop, on the shaft's east wall ----
  for (const [stopY, tag] of [
    [Y.GAR, "gar"],
    [Y.G, "g"],
    [Y.F2, "f2"],
    [Y.F3, "f3"],
    [Y.ROOF, "roof"],
  ]) {
    push(`lift_main_${tag}`, {
      ...GLASS_DOOR,
      x: PLAN.SHAFT.x1,
      y: stopY,
      z: 43,
      axis: "z",
      width: 2,
      height: 3,
      lift: "main",
      stopY,
      range: 3.2,
      label: "Glass elevator",
    });
  }

  // ---- underground garage ---------------------------------------------
  push("garage_gate", {
    ...STEEL_DOOR,
    x: PLAN.GARAGE_TUNNEL.x0,
    y: Y.GAR,
    z: PLAN.GARAGE_TUNNEL.z1,
    axis: "x",
    width: 6,
    height: 4,
    lockable: true,
    range: 5,
    label: "Garage security gate",
  });
  push("workshop", { ...STEEL_DOOR, x: 45, y: Y.GAR, z: 42, axis: "z", width: 2, height: 3 });
  push("storage", { ...STEEL_DOOR, x: 21, y: Y.GAR, z: 40, axis: "z", width: 2, height: 3 });

  // ---- secure lift: library vestibule down to the command centre ------
  for (const [stopY, tag] of [
    [Y.F2, "f2"],
    [Y.DEEP, "deep"],
  ]) {
    push(`lift_secure_${tag}`, {
      ...STEEL_DOOR,
      x: PLAN.SECURE.x0,
      y: stopY,
      z: 45,
      axis: "z",
      width: 2,
      height: 3,
      lift: "secure",
      stopY,
      lockable: true,
      range: 3.2,
      label: "Secure lift",
    });
  }

  // ---- deep level ------------------------------------------------------
  push("command_hall", {
    ...STEEL_DOOR,
    x: PLAN.COMMAND.x1 + 1,
    y: Y.DEEP,
    z: 45,
    axis: "z",
    width: 2,
    height: 3,
    lockable: true,
  });
  push("vault_blast", {
    ...VAULT_DOOR,
    x: PLAN.COMMAND.x0 - 1,
    y: Y.DEEP,
    z: 38,
    axis: "z",
    width: 4,
    height: 4,
    auto: false,
    lockable: true,
    label: "Vault blast door",
  });
  push("tunnel_hatch", {
    ...ROCK_DOOR,
    block: B.DARK_TILE,
    pane: B.DARK_TILE,
    x: PLAN.COMMAND.x0 - 1,
    y: Y.DEEP,
    z: 28,
    axis: "z",
    width: 4,
    height: 3,
    auto: false,
    label: "Escape tunnel hatch",
  });

  // ---- library secret wall --------------------------------------------
  push("secret_shelf", {
    ...SHELF_DOOR,
    x: 48,
    y: Y.F2,
    z: 43,
    axis: "x",
    width: 4,
    height: 3,
    auto: false,
    label: "Bookshelf wall",
  });

  // ---- escape tunnel exit ---------------------------------------------
  // sits in the outward face of the boulder, so from the garden it is stone
  push("tunnel_exit", {
    ...ROCK_DOOR,
    x: PLAN.TUNNEL_EXIT.x1 + 3,
    y: Y.G,
    z: 28,
    axis: "z",
    width: 2,
    height: 3,
    range: 3.4,
    label: "Disguised exit",
  });

  return d;
}

/* ------------------------------------------------------------------ *
 * Lighting zones
 *
 * Two big volumes, one marker id per fitting group. Switching the estate
 * between day, night and lockdown is a couple of dozen /fill ... replace
 * calls rather than thousands of block writes, which is what makes the
 * night-mode transformation cheap enough for a phone.
 * ------------------------------------------------------------------ */

/*
 * Within one volume every (group, state) block id has to be unique, otherwise
 * the reverse fill cannot tell two groups apart and half the lighting rig ends
 * up welded to the wrong fitting. HOUSE and GROUND are deliberately disjoint
 * in Y (3..30 vs -3..2) so the two sets may reuse ids between them.
 *
 * The practical rule this imposes on the build: above ground level, glowstone
 * is the only interior light fitting, polished diorite the only facade strip,
 * polished granite the only neon channel. Anything wanting a permanent light
 * below Y=3 (the garage) uses a froglight instead.
 */
function relativeZones() {
  const house = { x0: 1, y0: 3, z0: 11, x1: 62, y1: 30, z1: 53 };
  const ground = { x0: -2, y0: -3, z0: -2, x1: 65, y1: 2, z1: 73 };
  return [
    { id: "facade", vol: house, day: B.MARK_EXT, night: B.SEA_LANTERN, alarm: B.SHROOMLIGHT },
    { id: "neon", vol: house, day: B.MARK_NEON, night: B.FROG_VERDANT, alarm: B.MAGMA },
    { id: "interior", vol: house, day: B.GLOWSTONE, night: B.FROG_OCHRE, alarm: B.CRYING },
    { id: "helipad", vol: house, day: B.MARK_HELI, night: B.FROG_PEARL, alarm: B.BEACON },
    { id: "cover", vol: house, day: B.GLASS_CYAN, night: B.GLASS_CYAN, alarm: B.GLASS_RED },
    { id: "path", vol: ground, day: B.MARK_PATH, night: B.SEA_LANTERN, alarm: B.SHROOMLIGHT },
    { id: "pool", vol: ground, day: B.MARK_POOL, night: B.GLOWSTONE, alarm: B.CRYING },
  ];
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

function abs(origin, x, y, z) {
  return { x: origin.x + x, y: origin.y + y, z: origin.z + z };
}

/*
 * Chunks the builder must keep loaded while it works. A phone's simulation
 * distance is nowhere near wide enough to cover a 64x72 lot plus a hundred
 * block tunnel, and /fill in an unloaded chunk quietly does nothing.
 */
export function tickingClaims(origin) {
  return [
    {
      name: "lux_estate",
      from: { x: origin.x - 2, y: origin.y - 27, z: origin.z - 2 },
      to: { x: origin.x + 66, y: origin.y + 40, z: origin.z + 74 },
    },
    {
      name: "lux_tunnel",
      from: { x: origin.x - 82, y: origin.y - 27, z: origin.z + 22 },
      to: { x: origin.x + 26, y: origin.y + 16, z: origin.z + 38 },
    },
  ];
}

export function describeEstate(origin, dimensionId) {
  const doors = relativeDoors().map((door) => {
    const centreOffset = door.axis === "x" ? { x: door.width / 2, z: 0.5 } : { x: 0.5, z: door.width / 2 };
    return {
      ...door,
      x: origin.x + door.x,
      y: origin.y + door.y,
      z: origin.z + door.z,
      range: door.range ?? 3.4,
      lockable: door.lockable ?? false,
      stopY: door.stopY === undefined ? undefined : origin.y + door.stopY,
      centre: {
        x: origin.x + door.x + centreOffset.x,
        y: origin.y + door.y + door.height / 2,
        z: origin.z + door.z + centreOffset.z,
      },
    };
  });

  const zones = relativeZones().map((zone) => ({
    ...zone,
    vol: {
      x0: origin.x + zone.vol.x0,
      y0: origin.y + zone.vol.y0,
      z0: origin.z + zone.vol.z0,
      x1: origin.x + zone.vol.x1,
      y1: origin.y + zone.vol.y1,
      z1: origin.z + zone.vol.z1,
    },
  }));

  const lifts = [
    {
      id: "main",
      cab: {
        x0: origin.x + PLAN.CAB.x0,
        x1: origin.x + PLAN.CAB.x1,
        z0: origin.z + PLAN.CAB.z0,
        z1: origin.z + PLAN.CAB.z1,
      },
      /* The cab travels through the smart-lighting volume, so its own floor
       * and lamp must not use any id the lighting groups claim. */
      floorBlock: B.SMOOTH_QUARTZ,
      lightBlock: B.END_ROD,
      cabHeight: 4,
      home: origin.y + Y.G,
      stops: [
        { y: origin.y + Y.GAR, label: "Underground garage" },
        { y: origin.y + Y.G, label: "Ground floor" },
        { y: origin.y + Y.F2, label: "First floor" },
        { y: origin.y + Y.F3, label: "Second floor" },
        { y: origin.y + Y.ROOF, label: "Roof deck" },
      ],
    },
    {
      id: "secure",
      cab: {
        x0: origin.x + PLAN.SECURE_CAB.x0,
        x1: origin.x + PLAN.SECURE_CAB.x1,
        z0: origin.z + PLAN.SECURE_CAB.z0,
        z1: origin.z + PLAN.SECURE_CAB.z1,
      },
      floorBlock: B.DARK_TILE,
      lightBlock: B.END_ROD,
      cabHeight: 4,
      home: origin.y + Y.F2,
      stops: [
        { y: origin.y + Y.DEEP, label: "Command centre" },
        { y: origin.y + Y.F2, label: "Library vestibule" },
      ],
    },
  ];

  /* Buttons are tapped directly, which is the friendliest control on a
   * touchscreen. Every one of them also has a mirror in the remote's UI. */
  const buttons = [];
  const button = (x, y, z, action, states) =>
    buttons.push({ ...abs(origin, x, y, z), action, states });

  // command centre console row
  button(35, Y.DEEP + 1, 46, "lockdown_toggle", '["facing_direction"=1]');
  button(33, Y.DEEP + 1, 46, "lockdown_off", '["facing_direction"=1]');
  button(37, Y.DEEP + 1, 46, "vault_toggle", '["facing_direction"=1]');
  button(31, Y.DEEP + 1, 46, "tunnel_toggle", '["facing_direction"=1]');
  button(39, Y.DEEP + 1, 46, "lighting_cycle", '["facing_direction"=1]');
  // vault airlock, on the scanner plinth
  button(17, Y.DEEP + 1, 40, "vault_toggle", '["facing_direction"=1]');
  // library: discreet backup for the bookshelf wall
  button(56, Y.F2 + 1, 42, "shelf_toggle", '["facing_direction"=4]');
  // roof: helipad
  button(37, Y.ROOF + 1, 33, "helipad_toggle", '["facing_direction"=1]');
  // vehicle platform, one call point at each end
  button(43, Y.G + 1, 8, "platform_toggle", '["facing_direction"=1]');
  button(43, Y.GAR + 1, 15, "platform_toggle", '["facing_direction"=5]');
  // foyer lighting scene
  button(27, Y.G + 1, 24, "lighting_cycle", '["facing_direction"=5]');

  // lift call points, inside the cab and at every landing
  for (const lift of lifts) {
    for (const stop of lift.stops) {
      const relY = stop.y - origin.y;
      /* Mounting matters: a button placed on glass survives /setblock but
       * pops off on the next block update, so every call point is hung on a
       * solid face - the shaft's corner post outside, its solid west wall in. */
      if (lift.id === "main") {
        button(PLAN.SHAFT.x1 + 1, relY + 1, PLAN.SHAFT.z0, `lift:main:${relY}`, '["facing_direction"=5]');
        button(PLAN.CAB.x0, relY + 1, PLAN.CAB.z0, `lift:main:${relY}`, '["facing_direction"=5]');
      } else {
        button(PLAN.SECURE.x0 - 1, relY + 1, 45, `lift:secure:${relY}`, '["facing_direction"=4]');
        button(PLAN.SECURE_CAB.x0, relY + 1, PLAN.SECURE_CAB.z0, `lift:secure:${relY}`, '["facing_direction"=5]');
      }
    }
  }

  /* Hidden triggers: ordinary looking blocks that open secret doors when
   * tapped. Buttons above are the redundant path in case a device does not
   * deliver block-interact events. */
  const triggers = [
    { ...abs(origin, 55, Y.F2, 42), action: "shelf_toggle" }, // lectern in the library
    { ...abs(origin, 53, Y.F2 + 1, 42), action: "shelf_toggle" }, // odd shelf beside it
    { ...abs(origin, 26, Y.DEEP, 30), action: "tunnel_toggle" }, // flower pot by the hatch
    { ...abs(origin, 19, Y.DEEP, 39), action: "vault_toggle" }, // lodestone in the airlock
  ];

  const centre = abs(origin, 32, Y.G, 33);

  return {
    origin,
    dimensionId,
    centre,
    doors,
    zones,
    lifts,
    buttons,
    triggers,
    helipad: {
      x0: origin.x + PLAN.ROOFTOP_PAD.x0,
      x1: origin.x + PLAN.ROOFTOP_PAD.x1,
      z0: origin.z + PLAN.ROOFTOP_PAD.z0,
      z1: origin.z + PLAN.ROOFTOP_PAD.z1,
      y: origin.y + Y.ROOF + 1,
      deck: B.DARK_TILE,
      marker: B.MARK_HELI,
    },
    platform: {
      x0: origin.x + PLAN.LIFT_PAD.x0,
      x1: origin.x + PLAN.LIFT_PAD.x1,
      z0: origin.z + PLAN.LIFT_PAD.z0,
      z1: origin.z + PLAN.LIFT_PAD.z1,
      top: origin.y + Y.G_FLOOR,
      bottom: origin.y + Y.GAR_FLOOR,
      block: B.DARK_TILE,
      trim: B.MARK_HELI,
    },
    iris: {
      x: origin.x + PLAN.VAULT.x1 + 1,
      z0: origin.z + 37,
      z1: origin.z + 43,
      y0: origin.y + Y.DEEP,
      y1: origin.y + Y.DEEP + 4,
      shell: B.NETHERITE,
      core: B.GOLD,
    },
    tunnel: {
      x0: origin.x + PLAN.TUNNEL.x0,
      x1: origin.x + PLAN.TUNNEL.x1,
      z: origin.z + PLAN.TUNNEL.z0 + 1,
      y: origin.y + Y.DEEP + 4,
      lightBlock: B.SEA_LANTERN,
      offBlock: B.DARK_TILE,
      spacing: 5,
    },
    teleports: [
      { label: "Entrance driveway", ...abs(origin, 32, Y.G, 6) },
      { label: "Grand foyer", ...abs(origin, 32, Y.G, 22) },
      { label: "First floor landing", ...abs(origin, 31, Y.F2, 44) },
      { label: "Second floor landing", ...abs(origin, 31, Y.F3, 44) },
      { label: "Roof deck", ...abs(origin, 31, Y.ROOF, 38) },
      { label: "Underground garage", ...abs(origin, 30, Y.GAR, 25) },
      { label: "Command centre", ...abs(origin, 35, Y.DEEP, 40) },
      { label: "Secret vault", ...abs(origin, 10, Y.DEEP, 36) },
      { label: "Escape tunnel exit", ...abs(origin, -75, Y.G, 29) },
    ],
  };
}

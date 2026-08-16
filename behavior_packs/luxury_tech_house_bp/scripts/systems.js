/*
 * Luxury Tech House - the smart home itself.
 *
 * One Estate instance owns every live system: the sliding doors, the day /
 * night / lockdown lighting, both lifts, the vehicle platform, the retractable
 * helipad, the vault iris, the escape tunnel and the alarm.
 *
 * Performance shape, because this has to behave on a phone:
 *   - a single master interval runs every TUNE.TICK ticks and does nothing at
 *     all when no player is within TUNE.ESTATE_RADIUS of the estate centre;
 *   - lighting transitions are a dozen "/fill ... replace" calls, and only
 *     ever replace the state the estate is actually leaving;
 *   - animations (lifts, helipad, iris) run on their own short-lived intervals
 *     and clean themselves up the moment they finish.
 */

import { system, world, ItemStack, EquipmentSlot } from "@minecraft/server";
import { B, SFX, TUNE, Y, PLAN } from "./config.js";
import { ROOMS } from "./plan.js";
import { CommandQueue, Builder } from "./builder.js";
import { DoorSystem, maxFrame } from "./doors.js";
import {
  actionBarNear,
  dist2,
  isNight,
  safe,
  setBlock,
  soundAt,
  titleNear,
} from "./util.js";

const LIGHT_MODES = ["day", "night", "alarm"];

export class Estate {
  constructor(spec, saved = {}) {
    this.spec = spec;
    this.dimension = world.getDimension(spec.dimensionId);
    this.doors = new DoorSystem(spec, this.dimension);

    this.lockdown = !!saved.lock;
    this.lightOverride = saved.light ?? "auto"; // auto | day | night
    this.lighting = saved.lighting ?? null; // last applied, null = unknown
    this.flags = {
      helipad: true,
      platform: true,
      vault: false,
      tunnel: false,
      shelf: false,
      ...(saved.flags ?? {}),
    };

    this.lifts = new Map();
    for (const lift of spec.lifts) {
      const y = saved.lifts?.[lift.id] ?? lift.home;
      this.lifts.set(lift.id, { def: lift, y, moving: false, handle: undefined });
    }

    this.handles = [];
    this.alarmHandle = undefined;
    this.alarmPhase = 0;
    this.busy = new Set();
    /* Short-lived animation intervals. Tracked so rebuilding the estate cannot
     * leave a helipad or an iris still writing blocks at the old address. */
    this.animations = new Set();
  }

  /* ================================================================ *
   * Lifecycle
   * ================================================================ */

  attach() {
    this.detach();
    for (const lift of this.lifts.values()) this.paintCab(lift.def, lift.y, true);
    /* The door system repaints everything shut on its first tick, so any
     * concealed door that was open when the world unloaded has to be told to
     * re-open, or the saved flag and the blocks would disagree. */
    if (this.flags.vault) this.doors.setTarget("vault_blast", true);
    if (this.flags.shelf) this.doors.setTarget("secret_shelf", true);
    if (this.flags.tunnel) this.doors.setTarget("tunnel_hatch", true);
    this.refreshLighting(true);
    if (this.lockdown) this.startAlarm();
    this.handles.push(
      system.runInterval(() => safe(() => this.masterTick()), TUNE.TICK)
    );
    this.handles.push(
      system.runInterval(() => safe(() => this.clockTick()), TUNE.CLOCK_PERIOD)
    );
  }

  detach() {
    for (const handle of this.handles) safe(() => system.clearRun(handle));
    this.handles = [];
    this.stopAlarm();
    for (const lift of this.lifts.values()) {
      if (lift.handle !== undefined) safe(() => system.clearRun(lift.handle));
      lift.handle = undefined;
      lift.moving = false;
    }
    for (const handle of this.animations) safe(() => system.clearRun(handle));
    this.animations.clear();
    this.busy.clear();
  }

  /** Register an animation interval and hand back a matching stop function. */
  animation(period, step) {
    let handle;
    const stop = () => {
      safe(() => system.clearRun(handle));
      this.animations.delete(handle);
    };
    handle = system.runInterval(() => safe(() => step(stop)), period);
    this.animations.add(handle);
    return stop;
  }

  serialize() {
    const lifts = {};
    for (const [id, lift] of this.lifts) lifts[id] = lift.y;
    return {
      o: [this.spec.origin.x, this.spec.origin.y, this.spec.origin.z],
      d: this.spec.dimensionId,
      lock: this.lockdown,
      light: this.lightOverride,
      lighting: this.lighting,
      lifts,
      flags: this.flags,
    };
  }

  /* ================================================================ *
   * Master loop
   * ================================================================ */

  nearbyPlayers() {
    const found = [];
    const radius2 = TUNE.ESTATE_RADIUS * TUNE.ESTATE_RADIUS;
    for (const player of world.getAllPlayers()) {
      if (player.dimension.id !== this.spec.dimensionId) continue;
      if (dist2(player.location, this.spec.centre) > radius2) continue;
      found.push(player);
    }
    return found;
  }

  masterTick() {
    const players = this.nearbyPlayers();
    if (players.length === 0) return;

    const liftAt = new Map();
    for (const [id, lift] of this.lifts) {
      liftAt.set(id, { y: lift.y, moving: lift.moving });
    }
    this.doors.tick(players, { lockdown: this.lockdown, liftAt });
  }

  clockTick() {
    if (this.nearbyPlayers().length === 0) return;
    this.refreshLighting(false);
  }

  /* ================================================================ *
   * Smart lighting
   * ================================================================ */

  desiredLighting() {
    if (this.lockdown) return "alarm";
    if (this.lightOverride === "day") return "day";
    if (this.lightOverride === "night") return "night";
    return isNight() ? "night" : "day";
  }

  refreshLighting(force) {
    const want = this.desiredLighting();
    if (!force && want === this.lighting) return;
    this.applyLighting(want);
  }

  /**
   * Swap every light fitting to the requested state. Only the state the estate
   * is leaving is scanned for, unless the previous state is unknown (first run
   * after a world load), in which case all of them are.
   */
  applyLighting(mode) {
    const previous = this.lighting;
    const queue = new CommandQueue(this.dimension, 3);
    const builder = new Builder({ x: 0, y: 0, z: 0 }, queue);

    for (const zone of this.spec.zones) {
      const to = zone[mode];
      const sources = new Set(
        (previous ? [zone[previous]] : LIGHT_MODES.map((m) => zone[m])).filter(
          (id) => id && id !== to
        )
      );
      for (const from of sources) {
        builder.fill(
          zone.vol.x0,
          zone.vol.y0,
          zone.vol.z0,
          zone.vol.x1,
          zone.vol.y1,
          zone.vol.z1,
          to,
          { mode: "replace", replace: from }
        );
      }
    }

    this.lighting = mode;
    queue.start(undefined, () => {
      if (mode === "night" && !this.lockdown) {
        soundAt(this.spec.dimensionId, this.spec.centre, SFX.NIGHT, {
          volume: 0.4,
          pitch: 0.8,
          range: 80,
        });
        actionBarNear(
          this.spec.dimensionId,
          this.spec.centre,
          "§b● §fNight mode engaged §7- exterior, pool and pathway lighting online",
          80
        );
      }
    });
  }

  cycleLighting() {
    const order = ["auto", "night", "day"];
    const next = order[(order.indexOf(this.lightOverride) + 1) % order.length];
    this.lightOverride = next;
    this.refreshLighting(false);
    return next;
  }

  /* ================================================================ *
   * Lockdown
   * ================================================================ */

  setLockdown(on) {
    if (this.lockdown === on) return;
    this.lockdown = on;

    if (on) {
      this.doors.setGroupTarget((d) => d.lockable, false);
      if (this.flags.vault) this.animateIris(false);
      if (this.flags.shelf) this.doors.setTarget("secret_shelf", false);
      this.flags.vault = false;
      this.refreshLighting(true);
      this.startAlarm();
      titleNear(
        this.spec.dimensionId,
        this.spec.centre,
        "§c§lSECURITY LOCKDOWN ACTIVE",
        "§7All entrances sealed · vault secured · alarm armed"
      );
      soundAt(this.spec.dimensionId, this.spec.centre, SFX.LOCKDOWN, {
        volume: 1,
        pitch: 0.6,
        range: 120,
      });
    } else {
      this.stopAlarm();
      this.refreshLighting(true);
      titleNear(
        this.spec.dimensionId,
        this.spec.centre,
        "§a§lLOCKDOWN RELEASED",
        "§7Doors returning to automatic"
      );
      soundAt(this.spec.dimensionId, this.spec.centre, SFX.RELEASE, {
        volume: 0.8,
        pitch: 1.2,
        range: 120,
      });
    }
  }

  startAlarm() {
    if (this.alarmHandle !== undefined) return;
    this.alarmHandle = system.runInterval(() => {
      safe(() => {
        const players = this.nearbyPlayers();
        if (players.length === 0) return;
        this.alarmPhase ^= 1;
        soundAt(
          this.spec.dimensionId,
          this.spec.centre,
          this.alarmPhase ? SFX.ALARM_HI : SFX.ALARM_LO,
          { volume: 0.9, pitch: this.alarmPhase ? 0.7 : 0.55, range: 110 }
        );
        for (const player of players) {
          safe(() =>
            player.onScreenDisplay.setActionBar(
              "§4§l▮ §c§lSECURITY LOCKDOWN ACTIVE §4§l▮"
            )
          );
        }
      });
    }, TUNE.ALARM_PERIOD);
  }

  stopAlarm() {
    if (this.alarmHandle === undefined) return;
    safe(() => system.clearRun(this.alarmHandle));
    this.alarmHandle = undefined;
  }

  /* ================================================================ *
   * Lifts
   * ================================================================ */

  fillBlocks(x0, y0, z0, x1, y1, z1, id) {
    safe(() =>
      this.dimension.runCommand(
        `fill ${x0} ${y0} ${z0} ${x1} ${y1} ${z1} ${id}`
      )
    );
  }

  paintCab(def, y, place) {
    const floor = place ? def.floorBlock : B.AIR;
    const lamp = place ? def.lightBlock : B.AIR;
    this.fillBlocks(def.cab.x0, y - 1, def.cab.z0, def.cab.x1, y - 1, def.cab.z1, floor);
    this.fillBlocks(
      def.cab.x0,
      y + def.cabHeight - 1,
      def.cab.z0,
      def.cab.x1,
      y + def.cabHeight - 1,
      def.cab.z1,
      lamp
    );
  }

  ridersIn(def, y) {
    const found = [];
    for (const player of world.getAllPlayers()) {
      if (player.dimension.id !== this.spec.dimensionId) continue;
      const l = player.location;
      if (l.x < def.cab.x0 || l.x > def.cab.x1 + 1) continue;
      if (l.z < def.cab.z0 || l.z > def.cab.z1 + 1) continue;
      if (l.y < y - 1.5 || l.y > y + def.cabHeight) continue;
      found.push(player);
    }
    return found;
  }

  callLift(liftId, targetY) {
    const lift = this.lifts.get(liftId);
    if (!lift || lift.moving) return false;
    const stop = lift.def.stops.find((s) => s.y === targetY);
    if (!stop) return false;
    if (lift.y === targetY) {
      actionBarNear(this.spec.dimensionId, this.spec.centre, `§b▲ §f${stop.label}`, 40);
      return true;
    }

    lift.moving = true;
    const direction = targetY > lift.y ? 1 : -1;
    for (const rider of this.ridersIn(lift.def, lift.y)) {
      safe(() => rider.addEffect("slow_falling", 200, { showParticles: false }));
    }
    soundAt(this.spec.dimensionId, { x: lift.def.cab.x0, y: lift.y, z: lift.def.cab.z0 }, SFX.LIFT_START, {
      volume: 0.5,
      pitch: 1.4,
      range: 30,
    });

    lift.handle = system.runInterval(() => {
      safe(() => {
        const remaining = Math.abs(targetY - lift.y);
        const step = Math.min(TUNE.LIFT_STEP, remaining) * direction;
        const riders = this.ridersIn(lift.def, lift.y);

        this.paintCab(lift.def, lift.y, false);
        lift.y += step;
        this.paintCab(lift.def, lift.y, true);

        for (const rider of riders) {
          const l = rider.location;
          safe(() => rider.teleport({ x: l.x, y: l.y + step, z: l.z }));
        }

        if (lift.y === targetY) {
          safe(() => system.clearRun(lift.handle));
          lift.handle = undefined;
          lift.moving = false;
          soundAt(
            this.spec.dimensionId,
            { x: lift.def.cab.x0, y: lift.y, z: lift.def.cab.z0 },
            SFX.LIFT_ARRIVE,
            { volume: 0.7, pitch: 1.2, range: 30 }
          );
          for (const rider of this.ridersIn(lift.def, lift.y)) {
            safe(() => rider.onScreenDisplay.setActionBar(`§b▲ §f${stop.label}`));
          }
        }
      });
    }, TUNE.LIFT_FRAME_TICKS);
    return true;
  }

  /* ================================================================ *
   * Vehicle platform
   * ================================================================ */

  paintPlatform(y, place) {
    const P = this.spec.platform;
    this.fillBlocks(P.x0, y, P.z0, P.x1, y, P.z1, place ? P.block : B.AIR);
    if (place) {
      this.fillBlocks(P.x0, y, P.z0, P.x1, y, P.z0, P.trim);
      this.fillBlocks(P.x0, y, P.z1, P.x1, y, P.z1, P.trim);
    }
  }

  togglePlatform() {
    if (this.busy.has("platform")) return false;
    const P = this.spec.platform;
    const up = this.flags.platform;
    const from = up ? P.top : P.bottom;
    const to = up ? P.bottom : P.top;
    this.busy.add("platform");

    let y = from;
    const direction = to > from ? 1 : -1;
    this.animation(TUNE.PLATFORM_FRAME_TICKS, (stop) => {
      const riders = [];
      for (const player of world.getAllPlayers()) {
        if (player.dimension.id !== this.spec.dimensionId) continue;
        const l = player.location;
        if (l.x < P.x0 || l.x > P.x1 + 1) continue;
        if (l.z < P.z0 || l.z > P.z1 + 1) continue;
        if (l.y < y || l.y > y + 3) continue;
        riders.push(player);
      }
      this.paintPlatform(y, false);
      y += direction;
      this.paintPlatform(y, true);
      for (const rider of riders) {
        const l = rider.location;
        safe(() => rider.teleport({ x: l.x, y: l.y + direction, z: l.z }));
      }
      soundAt(this.spec.dimensionId, { x: P.x0, y, z: P.z0 }, SFX.HEAVY_OPEN, {
        volume: 0.25,
        pitch: 0.6,
        range: 24,
      });
      if (y === to) {
        stop();
        this.busy.delete("platform");
        this.flags.platform = !up;
        soundAt(this.spec.dimensionId, { x: P.x0, y, z: P.z0 }, SFX.LIFT_ARRIVE, {
          volume: 0.6,
          pitch: 0.9,
          range: 30,
        });
      }
    });
    return true;
  }

  /* ================================================================ *
   * Retractable helipad
   * ================================================================ */

  paintPadRow(z, present) {
    const P = this.spec.helipad;
    if (!present) {
      this.fillBlocks(P.x0, P.y, z, P.x1, P.y, z, B.AIR);
      return;
    }
    this.fillBlocks(P.x0, P.y, z, P.x1, P.y, z, P.deck);
    if (z === P.z0 || z === P.z1) {
      this.fillBlocks(P.x0, P.y, z, P.x1, P.y, z, P.marker);
      return;
    }
    setBlock(this.dimension, P.x0, P.y, z, P.marker);
    setBlock(this.dimension, P.x1, P.y, z, P.marker);
    const hx = P.x0 + 5;
    const hz = P.z0 + 5;
    if (z >= hz && z <= hz + 6) {
      setBlock(this.dimension, hx, P.y, z, P.marker);
      setBlock(this.dimension, hx + 5, P.y, z, P.marker);
    }
    if (z === hz + 3) this.fillBlocks(hx, P.y, z, hx + 5, P.y, z, P.marker);
  }

  toggleHelipad() {
    if (this.busy.has("helipad")) return false;
    const P = this.spec.helipad;
    const mid = P.z0 + Math.floor((P.z1 - P.z0 + 1) / 2);
    const steps = mid - P.z0;
    const extending = !this.flags.helipad;
    this.busy.add("helipad");

    let i = 0;
    this.animation(3, (stop) => {
      // retracting peels rows away from the centre line outwards
      const offset = extending ? steps - 1 - i : i;
      this.paintPadRow(mid - 1 - offset, extending);
      this.paintPadRow(mid + offset, extending);
      soundAt(this.spec.dimensionId, { x: P.x0, y: P.y, z: mid }, SFX.HEAVY_OPEN, {
        volume: 0.35,
        pitch: 0.7 + i * 0.05,
        range: 40,
      });
      i++;
      if (i >= steps) {
        stop();
        this.busy.delete("helipad");
        this.flags.helipad = extending;
        actionBarNear(
          this.spec.dimensionId,
          this.spec.centre,
          extending ? "§b▣ §fHelipad extended" : "§b▣ §fHelipad retracted",
          60
        );
      }
    });
    return true;
  }

  /* ================================================================ *
   * Vault: blast door then a four ring iris
   * ================================================================ */

  irisRing(radius, place) {
    const I = this.spec.iris;
    const zc = Math.floor((I.z0 + I.z1) / 2);
    const yc = Math.floor((I.y0 + I.y1) / 2);
    const id = place ? (radius === 0 ? I.core : I.shell) : B.AIR;
    if (radius === 0) {
      setBlock(this.dimension, I.x, yc, zc, id);
      return;
    }
    const z0 = zc - radius;
    const z1 = zc + radius;
    const y0 = yc - radius;
    const y1 = yc + radius;
    this.fillBlocks(I.x, y0, z0, I.x, y0, z1, id);
    this.fillBlocks(I.x, y1, z0, I.x, y1, z1, id);
    this.fillBlocks(I.x, y0, z0, I.x, y1, z0, id);
    this.fillBlocks(I.x, y0, z1, I.x, y1, z1, id);
  }

  animateIris(open) {
    if (this.busy.has("iris")) return false;
    const I = this.spec.iris;
    const zc = Math.floor((I.z0 + I.z1) / 2);
    const yc = Math.floor((I.y0 + I.y1) / 2);
    this.busy.add("iris");

    let step = 0;
    const rings = 4;
    this.animation(5, (stop) => {
      const radius = open ? step : rings - 1 - step;
      this.irisRing(radius, !open);
      soundAt(this.spec.dimensionId, { x: I.x, y: yc, z: zc }, SFX.VAULT_STEP, {
        volume: 0.8,
        pitch: 0.7 + step * 0.12,
        range: 40,
      });
      step++;
      if (step >= rings) {
        stop();
        this.busy.delete("iris");
        soundAt(this.spec.dimensionId, { x: I.x, y: yc, z: zc }, SFX.VAULT_DONE, {
          volume: 1,
          pitch: open ? 1.1 : 0.7,
          range: 60,
        });
        titleNear(
          this.spec.dimensionId,
          { x: I.x, y: yc, z: zc },
          open ? "§6§lVAULT OPEN" : "§6§lVAULT SEALED",
          open ? "§7Biometric lock released" : "§7Iris re-engaged",
          40
        );
      }
    });
    return true;
  }

  toggleVault() {
    if (this.lockdown) {
      actionBarNear(
        this.spec.dimensionId,
        this.spec.centre,
        "§c✖ Vault is sealed while lockdown is active",
        60
      );
      return false;
    }
    if (this.busy.has("iris")) return false;
    const opening = !this.flags.vault;
    this.flags.vault = opening;

    if (opening) {
      this.doors.setTarget("vault_blast", true);
      system.runTimeout(() => safe(() => this.animateIris(true)), 24);
    } else {
      this.animateIris(false);
      system.runTimeout(
        () => safe(() => this.doors.setTarget("vault_blast", false)),
        24
      );
    }
    return true;
  }

  /* ================================================================ *
   * Escape tunnel
   * ================================================================ */

  tunnelLights(on) {
    const T = this.spec.tunnel;
    const id = on ? T.lightBlock : T.offBlock;
    const positions = [];
    for (let x = T.x1 - 2; x >= T.x0 + 2; x -= T.spacing) {
      positions.push(x);
    }
    let i = 0;
    this.animation(2, (stop) => {
      for (let n = 0; n < 3 && i < positions.length; n++, i++) {
        const x = positions[i];
        setBlock(this.dimension, x, T.y, T.z - 1, id);
        setBlock(this.dimension, x, T.y, T.z + 2, id);
      }
      if (i >= positions.length) stop();
    });
  }

  toggleTunnel() {
    const opening = !this.flags.tunnel;
    this.flags.tunnel = opening;
    const T = this.spec.tunnel;

    if (opening) {
      // Keep the corridor loaded so the running lights reach the far end.
      safe(() => this.dimension.runCommand("tickingarea remove lux_tunnel"));
      safe(() =>
        this.dimension.runCommand(
          `tickingarea add ${T.x0} ${T.y - 6} ${T.z - 3} ${T.x1} ${T.y + 2} ${T.z + 4} lux_tunnel`
        )
      );
    }
    this.doors.setTarget("tunnel_hatch", opening);
    this.tunnelLights(opening);
    if (!opening) {
      system.runTimeout(
        () => safe(() => this.dimension.runCommand("tickingarea remove lux_tunnel")),
        100
      );
    }
    actionBarNear(
      this.spec.dimensionId,
      this.spec.centre,
      opening
        ? "§b▣ §fEscape tunnel open §7- lighting running west"
        : "§b▣ §fEscape tunnel sealed",
      80
    );
    return true;
  }

  /* ================================================================ *
   * Bookshelf wall
   * ================================================================ */

  toggleShelf() {
    const opening = !this.flags.shelf;
    this.flags.shelf = opening;
    this.doors.setTarget("secret_shelf", opening);
    const door = this.spec.doors.find((d) => d.id === "secret_shelf");
    if (door) {
      soundAt(this.spec.dimensionId, door.centre, SFX.HEAVY_OPEN, {
        volume: 0.9,
        pitch: 0.65,
        range: 30,
      });
      titleNear(
        this.spec.dimensionId,
        door.centre,
        opening ? "§b§lACCESS GRANTED" : "§7§lSEALED",
        opening ? "§7Command centre lift unlocked" : undefined,
        24
      );
    }
    return true;
  }

  /* ================================================================ *
   * Button and trigger dispatch
   * ================================================================ */

  dispatch(action, player) {
    switch (action) {
      case "lockdown_toggle":
        this.setLockdown(!this.lockdown);
        return true;
      case "lockdown_off":
        this.setLockdown(false);
        return true;
      case "lighting_cycle": {
        const mode = this.cycleLighting();
        if (player) {
          safe(() =>
            player.onScreenDisplay.setActionBar(
              `§b☀ §fLighting scene: §e${mode.toUpperCase()}`
            )
          );
        }
        return true;
      }
      case "vault_toggle":
        return this.toggleVault();
      case "tunnel_toggle":
        return this.toggleTunnel();
      case "shelf_toggle":
        return this.toggleShelf();
      case "helipad_toggle":
        return this.toggleHelipad();
      case "platform_toggle":
        return this.togglePlatform();
      default:
        break;
    }
    if (action.startsWith("lift:")) {
      const [, liftId, relY] = action.split(":");
      return this.callLift(liftId, this.spec.origin.y + Number(relY));
    }
    return false;
  }

  actionAt(x, y, z) {
    for (const btn of this.spec.buttons) {
      if (btn.x === x && btn.y === y && btn.z === z) return btn.action;
    }
    for (const trigger of this.spec.triggers) {
      if (trigger.x === x && trigger.y === y && trigger.z === z) return trigger.action;
    }
    return undefined;
  }

  /* ================================================================ *
   * Status text for the remote
   * ================================================================ */

  status() {
    const lines = [
      `§7Origin §f${this.spec.origin.x} ${this.spec.origin.y} ${this.spec.origin.z}`,
      `§7Security §f${this.lockdown ? "§cLOCKDOWN" : "§aNormal"}`,
      `§7Lighting §f${this.lighting ?? "-"} §8(${this.lightOverride})`,
      `§7Vault §f${this.flags.vault ? "open" : "sealed"}`,
      `§7Bookshelf wall §f${this.flags.shelf ? "open" : "closed"}`,
      `§7Escape tunnel §f${this.flags.tunnel ? "open" : "sealed"}`,
      `§7Helipad §f${this.flags.helipad ? "extended" : "retracted"}`,
      `§7Vehicle platform §f${this.flags.platform ? "at driveway" : "in garage"}`,
    ];
    for (const [id, lift] of this.lifts) {
      const stop = lift.def.stops.find((s) => s.y === lift.y);
      lines.push(`§7Lift §f${id} §8- §f${stop ? stop.label : lift.y}`);
    }
    const open = [...this.doors.state.values()].filter(
      (s) => s.frame >= maxFrame(s.door)
    ).length;
    lines.push(`§7Doors §f${open}§8/§f${this.spec.doors.length} open`);
    return lines;
  }
}

/* ================================================================== *
 * Post-build dressing that needs the scripting API rather than commands:
 * armour stands, stocked containers and aquarium life.
 * ================================================================== */

const ARMOUR_SETS = [
  ["netherite_helmet", "netherite_chestplate", "netherite_leggings", "netherite_boots", "netherite_sword"],
  ["diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots", "diamond_axe"],
  ["golden_helmet", "golden_chestplate", "golden_leggings", "golden_boots", "trident"],
  ["iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots", "crossbow"],
];

const VAULT_LOOT = [
  ["minecraft:diamond", 64],
  ["minecraft:emerald", 64],
  ["minecraft:gold_ingot", 64],
  ["minecraft:netherite_ingot", 16],
  ["minecraft:ancient_debris", 32],
  ["minecraft:enchanted_golden_apple", 8],
  ["minecraft:totem_of_undying", 4],
  ["minecraft:elytra", 1],
];

const WORKSHOP_LOOT = [
  ["minecraft:iron_ingot", 64],
  ["minecraft:redstone", 64],
  ["minecraft:copper_ingot", 64],
  ["minecraft:amethyst_shard", 32],
  ["minecraft:glowstone_dust", 64],
];

/**
 * Where the post-build dressing goes. Kept separate from furnish() so the
 * offline validator can check each target against the finished mansion -
 * an armour stand spawned inside a wall or a chest address that turns out to
 * be a workbench is invisible at runtime, because both fail silently.
 */
export function furnishPlan(spec) {
  const o = spec.origin;
  const at = (x, y, z) => ({ x: o.x + x, y: o.y + y, z: o.z + z });
  const V = PLAN.VAULT;
  const W = ROOMS.WORKSHOP;

  const armourStands = ARMOUR_SETS.map((set, i) => ({
    location: at(V.x0 + 1, Y.DEEP + 1, V.z0 + 2 + i * 3),
    support: at(V.x0 + 1, Y.DEEP, V.z0 + 2 + i * 3),
    set,
  }));

  const containers = [];
  for (let i = 0; i < 4; i++) {
    containers.push({ location: at(V.x0 + 2 + i, Y.DEEP, V.z0 + 9), items: VAULT_LOOT });
  }
  for (let i = 0; i < 4; i++) {
    containers.push({ location: at(W.x1, Y.GAR, W.z0 + 1 + i * 3), items: WORKSHOP_LOOT });
  }

  /* Deliberately few fish: the aquarium should read as stocked without
   * putting a crowd of ticking entities on a phone's budget. */
  const fish = [];
  for (const tankX of [10, 21]) {
    for (let i = 0; i < 4; i++) {
      fish.push({ type: "minecraft:tropicalfish", location: at(tankX + (i % 2), Y.G + 1, 36 + (i % 2)) });
    }
  }
  fish.push({ type: "minecraft:pufferfish", location: at(11, Y.G + 1, 37) });
  fish.push({ type: "minecraft:cod", location: at(22, Y.G + 1, 37) });

  return { armourStands, containers, fish };
}

function stock(dimension, location, items) {
  safe(() => {
    const block = dimension.getBlock(location);
    const container = block?.getComponent("minecraft:inventory")?.container;
    if (!container) return;
    items.forEach(([id, count], slot) => {
      if (slot >= container.size) return;
      safe(() => container.setItem(slot, new ItemStack(id, count)));
    });
  });
}

export function furnish(spec) {
  const dimension = world.getDimension(spec.dimensionId);
  const plan = furnishPlan(spec);
  const slots = [
    EquipmentSlot.Head,
    EquipmentSlot.Chest,
    EquipmentSlot.Legs,
    EquipmentSlot.Feet,
    EquipmentSlot.Mainhand,
  ];

  for (const stand of plan.armourStands) {
    safe(() => {
      const entity = dimension.spawnEntity("minecraft:armor_stand", stand.location);
      const equipment = entity.getComponent("minecraft:equippable");
      if (!equipment) return;
      stand.set.forEach((item, n) => {
        safe(() => equipment.setEquipment(slots[n], new ItemStack(`minecraft:${item}`)));
      });
    });
  }

  for (const entry of plan.containers) stock(dimension, entry.location, entry.items);
  for (const entry of plan.fish) {
    safe(() => dimension.spawnEntity(entry.type, entry.location));
  }
}

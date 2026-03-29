/**
 * PhysicsBuffers — SharedArrayBuffer layout for main↔worker physics sync.
 *
 * Two shared buffers enable lock-free communication:
 *
 * 1. Transform Buffer (worker → main): positions, rotations, velocities per body
 *    Layout per slot: [px, py, pz, qx, qy, qz, qw, vx, vy, vz] = 10 floats
 *
 * 2. Command Buffer (main → worker): per-frame velocity/position/impulse commands
 *    Layout per command: [type, slot, f0, f1, f2, f3, f4, f5] = 8 floats
 *
 * Control region (first 16 floats of transform buffer):
 *    [0] stepRequested  (1 = main wants worker to step)
 *    [1] stepComplete   (1 = worker finished stepping)
 *    [2] dt             (delta time for this step)
 *    [3] commandCount   (number of commands in command buffer)
 *    [4-15] reserved
 */

// ── Layout Constants ───────────────────────────────────────────

/** Maximum number of physics bodies (slots).
 *  All pools use canGrow:true, so with reproduction the entity count
 *  can far exceed initial pool sizes (e.g. 60 fish × 12 offspring = 720).
 *  1024 gives comfortable headroom for worst-case populations. */
export const MAX_BODIES = 1024;

/** Floats per body slot in the transform buffer */
export const FLOATS_PER_BODY = 10;  // pos(3) + rot(4) + vel(3)

/** Control region size (floats at start of transform buffer) */
export const CONTROL_FLOATS = 16;

/** Total floats in transform buffer */
export const TRANSFORM_BUFFER_FLOATS = CONTROL_FLOATS + MAX_BODIES * FLOATS_PER_BODY;

/** Bytes for transform buffer */
export const TRANSFORM_BUFFER_BYTES = TRANSFORM_BUFFER_FLOATS * 4;

/** Maximum commands per frame.
 *  Each food pushes 2 commands (setVelocity + setPosition) per frame,
 *  plus creatures, seeds, and player.  With full plant populations
 *  producing food, 512 overflows.  2048 gives 4× headroom.  Cost:
 *  2048 × 8 floats × 4 bytes = 64 KB — negligible. */
export const MAX_COMMANDS = 2048;

/** Floats per command */
export const FLOATS_PER_COMMAND = 8;  // type(1) + slot(1) + data(6)

/** Total floats in command buffer */
export const COMMAND_BUFFER_FLOATS = MAX_COMMANDS * FLOATS_PER_COMMAND;

/** Bytes for command buffer */
export const COMMAND_BUFFER_BYTES = COMMAND_BUFFER_FLOATS * 4;

// ── Control Indices ────────────────────────────────────────────

export const CTRL_STEP_REQUESTED = 0;
export const CTRL_STEP_COMPLETE = 1;
export const CTRL_DT = 2;
export const CTRL_COMMAND_COUNT = 3;

// ── Command Types ──────────────────────────────────────────────

export const CMD_SET_VELOCITY = 1;
export const CMD_SET_POSITION = 2;
export const CMD_ADD_IMPULSE = 3;
export const CMD_SET_GRAVITY_FACTOR = 4;
export const CMD_ACTIVATE = 5;

// ── Helper: get offset into transform buffer for a body slot ──

/**
 * Get the Float32Array offset for a given body slot.
 * @param {number} slot — body slot index (0..MAX_BODIES-1)
 * @returns {number} offset into the transform Float32Array
 */
export function bodyOffset(slot) {
  return CONTROL_FLOATS + slot * FLOATS_PER_BODY;
}

/**
 * Write a command into the command buffer.
 * @param {Float32Array} commands — the shared command array
 * @param {number} index — command index (0..MAX_COMMANDS-1)
 * @param {number} type — CMD_* constant
 * @param {number} slot — body slot index
 * @param {number} f0..f5 — command data (varies by type)
 */
export function writeCommand(commands, index, type, slot, f0 = 0, f1 = 0, f2 = 0, f3 = 0, f4 = 0, f5 = 0) {
  const o = index * FLOATS_PER_COMMAND;
  commands[o]     = type;
  commands[o + 1] = slot;
  commands[o + 2] = f0;
  commands[o + 3] = f1;
  commands[o + 4] = f2;
  commands[o + 5] = f3;
  commands[o + 6] = f4;
  commands[o + 7] = f5;
}

/**
 * Create the shared buffers for physics communication.
 * @returns {{ transformSAB: SharedArrayBuffer, commandSAB: SharedArrayBuffer,
 *             transforms: Float32Array, control: Int32Array, commands: Float32Array }}
 */
export function createPhysicsBuffers() {
  const transformSAB = new SharedArrayBuffer(TRANSFORM_BUFFER_BYTES);
  const commandSAB = new SharedArrayBuffer(COMMAND_BUFFER_BYTES);

  return {
    transformSAB,
    commandSAB,
    transforms: new Float32Array(transformSAB),
    // Int32Array view over the control region for Atomics (memory barriers).
    // Indices 0-3 map to the same bytes as transforms[0]-transforms[3]:
    //   control[0] = CTRL_STEP_REQUESTED
    //   control[1] = CTRL_STEP_COMPLETE
    //   control[2] = CTRL_DT      (use transforms[] for float reads)
    //   control[3] = CTRL_COMMAND_COUNT (integer, safe via either view)
    control: new Int32Array(transformSAB, 0, CONTROL_FLOATS),
    commands: new Float32Array(commandSAB),
  };
}

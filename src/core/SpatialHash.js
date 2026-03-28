/**
 * SpatialHash — 2D grid-based spatial partitioning for O(nearby) entity queries
 * Hashes entities into XZ plane cells using Cantor pairing.
 * Replaces O(n²) brute-force collision checks with O(nearby) lookups.
 */
export class SpatialHash {
  /**
   * @param {number} cellSize - Width/height of each cell in world units
   */
  constructor(cellSize = 5) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.cells = new Map(); // key → [entity, entity, ...]
  }

  /**
   * Clear all cells. Call at the start of each frame before rebuilding.
   */
  clear() {
    this.cells.clear();
  }

  /**
   * Hash a world position to a cell key using Cantor pairing function.
   * @param {number} x
   * @param {number} z
   * @returns {number} Cell key
   * @private
   */
  _key(x, z) {
    const cx = (x * this.invCellSize) | 0;
    const cz = (z * this.invCellSize) | 0;
    return ((cx * 73856093) ^ (cz * 19349663)) | 0;
  }

  /**
   * Insert an entity at a world position.
   * @param {*} entity - Any object to store
   * @param {number} x - X coordinate (world space)
   * @param {number} z - Z coordinate (world space)
   */
  insert(entity, x, z) {
    const key = this._key(x, z);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(entity);
  }

  /**
   * Query all entities within a radius of a point.
   * Returns results in a pre-allocated array to avoid per-frame allocations.
   * @param {number} x - Center X (world space)
   * @param {number} z - Center Z (world space)
   * @param {number} radius - Search radius
   * @param {Array} results - Pre-allocated results array (will be cleared and filled)
   * @returns {Array} The results array
   */
  query(x, z, radius, results) {
    results.length = 0;
    const cr = Math.ceil(radius * this.invCellSize);
    const cx0 = (x * this.invCellSize) | 0;
    const cz0 = (z * this.invCellSize) | 0;
    for (let dx = -cr; dx <= cr; dx++) {
      for (let dz = -cr; dz <= cr; dz++) {
        const key = (((cx0 + dx) * 73856093) ^ ((cz0 + dz) * 19349663)) | 0;
        const cell = this.cells.get(key);
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            results.push(cell[i]);
          }
        }
      }
    }
    return results;
  }
}

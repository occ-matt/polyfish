import { describe, it, expect, vi } from 'vitest';
import { ObjectPool } from '../src/core/ObjectPool.js';

describe('ObjectPool', () => {
  function makePool(size = 3, opts = {}) {
    let id = 0;
    return new ObjectPool({
      factory: () => ({ id: id++, active: false }),
      initialSize: size,
      canGrow: opts.canGrow !== false,
      onActivate: opts.onActivate || (() => {}),
      onDeactivate: opts.onDeactivate || (() => {}),
    });
  }

  it('creates pool with initialSize items', () => {
    const pool = makePool(5);
    expect(pool.getTotalSize()).toBe(5);
    expect(pool.getActiveCount()).toBe(0);
  });

  it('get() returns an item and marks it active', () => {
    const pool = makePool(3);
    const item = pool.get();
    expect(item).not.toBeNull();
    expect(item.active).toBe(true);
    expect(pool.getActiveCount()).toBe(1);
  });

  it('release() deactivates item and returns it to pool', () => {
    const pool = makePool(3);
    const item = pool.get();
    pool.release(item);
    expect(item.active).toBe(false);
    expect(pool.getActiveCount()).toBe(0);
  });

  it('reuses released items', () => {
    const pool = makePool(2);
    const item1 = pool.get();
    pool.release(item1);
    const item2 = pool.get();
    expect(item2).toBe(item1); // same object reused
  });

  it('grows when all items are active and canGrow is true', () => {
    const pool = makePool(2, { canGrow: true });
    pool.get();
    pool.get();
    expect(pool.getTotalSize()).toBe(2);
    const item3 = pool.get();
    expect(item3).not.toBeNull();
    expect(pool.getTotalSize()).toBe(3);
  });

  it('returns null when full and canGrow is false', () => {
    const pool = makePool(2, { canGrow: false });
    pool.get();
    pool.get();
    const item3 = pool.get();
    expect(item3).toBeNull();
  });

  it('getActiveItems() returns only active items', () => {
    const pool = makePool(3);
    pool.get();
    const item2 = pool.get();
    pool.get();
    pool.release(item2);
    const active = pool.getActiveItems();
    expect(active.length).toBe(2);
    expect(active.every(i => i.active)).toBe(true);
  });

  it('releaseAll() deactivates everything', () => {
    const pool = makePool(3);
    pool.get();
    pool.get();
    pool.get();
    expect(pool.getActiveCount()).toBe(3);
    pool.releaseAll();
    expect(pool.getActiveCount()).toBe(0);
  });

  it('forEach() iterates over active items', () => {
    const pool = makePool(3);
    pool.get();
    pool.get();
    const ids = [];
    pool.forEach(item => ids.push(item.id));
    expect(ids.length).toBe(2);
  });

  it('calls onActivate and onDeactivate callbacks', () => {
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();
    const pool = makePool(2, { onActivate, onDeactivate });

    const item = pool.get();
    expect(onActivate).toHaveBeenCalledWith(item);

    pool.release(item);
    expect(onDeactivate).toHaveBeenCalledWith(item);
  });
});

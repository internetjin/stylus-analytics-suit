import { ResolvedSelector } from "./compute";

export type CollisionGroup = {
  selector: string;
  signatures: string[];
};

export type CollisionReport = {
  totalFunctions: number;
  uniqueSelectors: number;
  collisions: CollisionGroup[];
};

export function detectCollisions(
  resolved: ResolvedSelector[]
): CollisionReport {
  const bySelector = new Map<string, Set<string>>();
  for (const r of resolved) {
    let set = bySelector.get(r.selector);
    if (!set) {
      set = new Set();
      bySelector.set(r.selector, set);
    }
    set.add(r.signature);
  }

  const collisions: CollisionGroup[] = [];
  for (const [sel, sigs] of bySelector) {
    if (sigs.size > 1) {
      collisions.push({ selector: sel, signatures: [...sigs].sort() });
    }
  }

  return {
    totalFunctions: resolved.length,
    uniqueSelectors: bySelector.size,
    collisions,
  };
}

import { isDeepStrictEqual } from "node:util";

// Identical duplicates collapse to one; duplicates that differ in anything are all rejected (D-22).
export function dedupe<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  onDuplicate: (key: string, identical: boolean) => void,
): Map<string, T | undefined> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const resolved = new Map<string, T | undefined>();
  for (const [key, group] of groups) resolved.set(key, resolveGroup(key, group, onDuplicate));
  return resolved;
}

function resolveGroup<T>(key: string, group: T[], onDuplicate: (key: string, identical: boolean) => void): T | undefined {
  const [first, ...rest] = group;
  if (rest.length === 0) return first;

  const identical = rest.every((item) => isDeepStrictEqual(item, first));
  onDuplicate(key, identical);
  return identical ? first : undefined;
}

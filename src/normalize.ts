const US_NAMES = new Set(["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"]);

export function canonicalId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim().toUpperCase();
  return id === "" ? undefined : id;
}

export function canonicalCountry(value: unknown): string | undefined {
  return canonicalId(value)?.replace(/\s+/g, " ");
}

export function isUnitedStates(country: string): boolean {
  return US_NAMES.has(country);
}

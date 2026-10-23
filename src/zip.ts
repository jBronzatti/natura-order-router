// Rule 2 applied literally: the first 3 characters, no padding or format checks (D-01).
export function zipPrefix(raw: unknown): string | undefined {
  return zipText(raw)?.slice(0, 3);
}

function zipText(raw: unknown): string | undefined {
  if (typeof raw === "number") return String(raw);
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  return text === "" ? undefined : text;
}

/** Human-readable labels; database status values remain unchanged. */
export function statusLabel(value: string) {
  const label = value.toLowerCase().replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

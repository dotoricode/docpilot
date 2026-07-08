export type ContextLocation = {
  from: number;
  to: number;
  lineStart?: number;
  lineEnd?: number;
};

export function formatContextLocation(item: ContextLocation) {
  if (item.lineStart && item.lineEnd) {
    return item.lineStart === item.lineEnd
      ? `Lines: ${item.lineStart}`
      : `Lines: ${item.lineStart}-${item.lineEnd}`;
  }

  return `Range: ${item.from}-${item.to}`;
}

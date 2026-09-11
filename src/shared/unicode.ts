/** Unicode code-point (not grapheme-cluster) string helpers. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function codePointOffsetToCodeUnitOffset(value: string, offset: number): number {
  assertOffset(offset, codePointLength(value));
  return Array.from(value).slice(0, offset).join("").length;
}

export function codeUnitOffsetToCodePointOffset(value: string, offset: number): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > value.length) {
    throw new RangeError("Code-unit offset is out of bounds.");
  }
  if (offset > 0 && offset < value.length) {
    const unit = value.charCodeAt(offset);
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new RangeError("Code-unit offset splits a surrogate pair.");
    }
  }
  return Array.from(value.slice(0, offset)).length;
}

export function sliceCodePoints(value: string, start: number, end: number): string {
  const points = Array.from(value);
  assertRange(start, end, points.length);
  return points.slice(start, end).join("");
}

export function replaceCodePointRange(
  value: string,
  start: number,
  end: number,
  replacement: string,
): string {
  const points = Array.from(value);
  assertRange(start, end, points.length);
  points.splice(start, end - start, ...Array.from(replacement));
  return points.join("");
}

function assertOffset(offset: number, length: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > length) {
    throw new RangeError("Code-point offset is out of bounds.");
  }
}

function assertRange(start: number, end: number, length: number): void {
  assertOffset(start, length);
  assertOffset(end, length);
  if (end < start) throw new RangeError("Code-point range is invalid.");
}

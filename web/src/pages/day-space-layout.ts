export type DaySpaceLayoutInput = {
  id: string;
  density?: number;
};

type DaySpacePaperSize = "small" | "medium" | "large";

type DaySpaceLayoutItem = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  size: DaySpacePaperSize;
};

export type DaySpaceLayout = {
  items: DaySpaceLayoutItem[];
  stageHeight: number;
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: string): number {
  return (hashString(seed) % 100000) / 100000;
}

function chooseSize(seed: string, density: number): DaySpacePaperSize {
  if (density >= 5) return "large";
  if (density <= 1) return seededUnit(`${seed}:size`) < 0.74 ? "small" : "medium";
  if (density >= 4) return seededUnit(`${seed}:size`) < 0.64 ? "large" : "medium";
  return seededUnit(`${seed}:size`) < 0.58 ? "medium" : "large";
}

function dimensions(size: DaySpacePaperSize, stageWidth: number) {
  if (size === "small") {
    return {
      width: Math.min(158, stageWidth * 0.46),
      height: 112,
    };
  }

  if (size === "large") {
    return {
      width: Math.min(218, stageWidth * 0.64),
      height: 158,
    };
  }

  return {
    width: Math.min(186, stageWidth * 0.55),
    height: 134,
  };
}

function overlapFraction(
  left: DaySpaceLayoutItem,
  right: Pick<DaySpaceLayoutItem, "left" | "top" | "width" | "height">,
) {
  const width = Math.max(
    0,
    Math.min(left.left + left.width, right.left + right.width) -
      Math.max(left.left, right.left),
  );
  const height = Math.max(
    0,
    Math.min(left.top + left.height, right.top + right.height) -
      Math.max(left.top, right.top),
  );

  if (width === 0 || height === 0) return 0;

  const overlapArea = width * height;
  const smallerArea = Math.min(
    left.width * left.height,
    right.width * right.height,
  );

  return overlapArea / smallerArea;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function layoutDaySpacePapers(
  dateKey: string,
  papers: readonly DaySpaceLayoutInput[],
  rawStageWidth: number,
): DaySpaceLayout {
  const stageWidth = Math.max(280, rawStageWidth);
  const ordered = [...papers].sort(
    (a, b) =>
      hashString(`${dateKey}:${a.id}:order`) -
      hashString(`${dateKey}:${b.id}:order`),
  );

  const placed: DaySpaceLayoutItem[] = [];
  const laneRatios = [0, 0.5, 1];

  ordered.forEach((paper, index) => {
    const seed = `${dateKey}:${paper.id}`;
    const density = Math.max(1, paper.density ?? 3);
    const size = chooseSize(seed, density);
    const { width, height } = dimensions(size, stageWidth);
    const maxLeft = Math.max(0, stageWidth - width);

    let lane = hashString(`${seed}:lane`) % laneRatios.length;

    if (index > 0) {
      const previous = placed[index - 1];
      const previousCenter = previous.left + previous.width / 2;
      const candidateCenter = maxLeft * laneRatios[lane] + width / 2;

      if (Math.abs(previousCenter - candidateCenter) < 62) {
        lane = (lane + 1 + (hashString(`${seed}:lane-shift`) % 2)) % 3;
      }
    }

    const horizontalJitter =
      (seededUnit(`${seed}:x`) - 0.5) * Math.min(26, maxLeft * 0.14);
    let left = clamp(maxLeft * laneRatios[lane] + horizontalJitter, 0, maxLeft);

    const bandStep =
      103 +
      seededUnit(`${dateKey}:${index}:band-step`) * 31;
    let top =
      10 +
      index * bandStep +
      (seededUnit(`${seed}:y`) - 0.5) * 34;

    const rotation = -3.4 + seededUnit(`${seed}:rotation`) * 6.8;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = { left, top, width, height };
      const worst = placed.reduce(
        (value, existing) =>
          Math.max(value, overlapFraction(existing, candidate)),
        0,
      );

      if (worst <= 0.15) break;

      const alternateLane = (lane + 1 + attempt) % 3;
      left = clamp(
        maxLeft * laneRatios[alternateLane] +
          (seededUnit(`${seed}:retry-x:${attempt}`) - 0.5) * 20,
        0,
        maxLeft,
      );
      top += 16 + attempt * 4;
    }

    placed.push({
      id: paper.id,
      left,
      top: Math.max(0, top),
      width,
      height,
      rotation,
      zIndex: 2 + (hashString(`${seed}:z`) % 7),
      size,
    });
  });

  const finalBottom = placed.reduce(
    (value, item) => Math.max(value, item.top + item.height),
    0,
  );

  return {
    items: placed,
    stageHeight: Math.max(260, finalBottom + 52),
  };
}

/** Keep complete preview lines above the signature, including overflow dots. */
export function daySpacePreviewLineLimit(
  size: DaySpacePaperSize,
  kind: "todo" | "memory",
  count: number,
  hasMore: boolean,
): 1 | 2 {
  const height = size === "small" ? 112 : size === "medium" ? 134 : 158;
  const lineHeight = kind === "todo" ? 14.7 : 15.2;
  const gap = kind === "todo" ? 7 : 8;
  const needed =
    count * 2 * lineHeight +
    Math.max(0, count - 1) * gap +
    (hasMore ? 11 + gap : 0);
  return needed <= height - 39 ? 2 : 1;
}

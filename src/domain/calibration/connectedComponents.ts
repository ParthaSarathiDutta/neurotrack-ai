export interface Point {
  x: number;
  y: number;
}

export interface Blob {
  label: number;
  area: number;
  centroid: Point;
  pixels: Point[];
  compactness: number;
}

/** 4-connected components on a binary mask (true = foreground). */
export function findConnectedComponents(
  mask: boolean[],
  width: number,
  height: number,
): Blob[] {
  const labels = new Int32Array(width * height).fill(-1);
  const blobs: Blob[] = [];
  let nextLabel = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!mask[idx] || labels[idx] >= 0) continue;

      const pixels: Point[] = [];
      const stack: Point[] = [{ x, y }];
      labels[idx] = nextLabel;

      while (stack.length > 0) {
        const p = stack.pop()!;
        pixels.push(p);
        const neighbors = [
          { x: p.x + 1, y: p.y },
          { x: p.x - 1, y: p.y },
          { x: p.x, y: p.y + 1 },
          { x: p.x, y: p.y - 1 },
        ];
        for (const n of neighbors) {
          if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) continue;
          const ni = n.y * width + n.x;
          if (!mask[ni] || labels[ni] >= 0) continue;
          labels[ni] = nextLabel;
          stack.push(n);
        }
      }

      let sumX = 0;
      let sumY = 0;
      for (const p of pixels) {
        sumX += p.x;
        sumY += p.y;
      }
      const area = pixels.length;
      const perimeter = estimatePerimeter(pixels, width, height);
      const compactness = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;

      blobs.push({
        label: nextLabel,
        area,
        centroid: { x: sumX / area, y: sumY / area },
        pixels,
        compactness,
      });
      nextLabel += 1;
    }
  }
  return blobs;
}

function estimatePerimeter(pixels: Point[], width: number, height: number): number {
  const set = new Set(pixels.map((p) => `${p.x},${p.y}`));
  let perimeter = 0;
  for (const p of pixels) {
    const neighbors = [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 },
    ];
    for (const n of neighbors) {
      if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height || !set.has(`${n.x},${n.y}`)) {
        perimeter += 1;
      }
    }
  }
  return perimeter;
}

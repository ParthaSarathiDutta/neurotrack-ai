/** Otsu threshold for grayscale image data (single channel, row-major). */
export function otsuThreshold(data: Uint8ClampedArray, width: number, height: number): number {
  const histogram = new Array<number>(256).fill(0);
  const total = width * height;
  for (let i = 0; i < data.length; i += 4) {
    histogram[data[i]] += 1;
  }

  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t += 1) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) ** 2;
    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }
  return threshold;
}

/** Median of several RGBA frames (per channel, grayscale luminance). */
export function medianGrayscaleFrame(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
): Uint8ClampedArray {
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const values = new Array<number>(frames.length);
  for (let p = 0; p < n; p += 1) {
    for (let f = 0; f < frames.length; f += 1) {
      values[f] = frames[f][p * 4];
    }
    values.sort((a, b) => a - b);
    const gray = values[Math.floor(values.length / 2)];
    const i = p * 4;
    out[i] = gray;
    out[i + 1] = gray;
    out[i + 2] = gray;
    out[i + 3] = 255;
  }
  return out;
}

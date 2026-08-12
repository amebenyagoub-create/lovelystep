import sharp from "sharp";

type RawImage = {
  data: Buffer;
  width: number;
  height: number;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function median(values: number[]): number {
  if (!values.length) return 0;
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
}

async function rawImage(image: Buffer): Promise<RawImage> {
  const result = await sharp(image, { failOn: "error", limitInputPixels: 80_000_000 })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: result.data, width: result.info.width, height: result.info.height };
}

function borderSamples(image: RawImage): Array<[number, number, number]> {
  const { data, width, height } = image;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 180));
  const samples: Array<[number, number, number]> = [];
  const push = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] >= 245) samples.push([data[offset], data[offset + 1], data[offset + 2]]);
  };
  for (let x = 0; x < width; x += step) { push(x, 0); push(x, height - 1); }
  for (let y = step; y < height - step; y += step) { push(0, y); push(width - 1, y); }
  return samples;
}

/**
 * Production-safe fallback for marketplace photos with a white or uniform background.
 * Only pixels connected to an image border can be removed, so pale details inside the
 * garment are preserved instead of being globally keyed out.
 */
export async function removeConnectedSimpleBackground(image: Buffer): Promise<Buffer> {
  const source = await rawImage(image);
  const { data, width, height } = source;
  const pixels = width * height;
  let transparentPixels = 0;
  for (let index = 3; index < data.length; index += 4) if (data[index] < 245) transparentPixels += 1;
  if (transparentPixels / pixels >= 0.015) return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();

  const samples = borderSamples(source);
  if (samples.length < 8) return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const background = [median(samples.map((sample) => sample[0])), median(samples.map((sample) => sample[1])), median(samples.map((sample) => sample[2]))];
  const sampleDistances = samples.map(([red, green, blue]) => Math.sqrt((red - background[0]) ** 2 + (green - background[1]) ** 2 + (blue - background[2]) ** 2));
  const tolerance = clamp(30 + median(sampleDistances) * 2.2, 34, 78);
  const toleranceSquared = tolerance ** 2;
  const backgroundBrightness = (background[0] + background[1] + background[2]) / 3;
  const states = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;

  const qualifies = (pixel: number) => {
    const offset = pixel * 4;
    if (data[offset + 3] < 245) return true;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const distanceSquared = (red - background[0]) ** 2 + (green - background[1]) ** 2 + (blue - background[2]) ** 2;
    if (distanceSquared <= toleranceSquared) return true;
    const brightness = (red + green + blue) / 3;
    const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
    return backgroundBrightness >= 225 && brightness >= 238 && spread <= 24;
  };
  const visit = (pixel: number) => {
    if (states[pixel] !== 0) return;
    if (!qualifies(pixel)) { states[pixel] = 2; return; }
    states[pixel] = 1;
    queue[tail++] = pixel;
  };

  for (let x = 0; x < width; x += 1) { visit(x); visit((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    if (x > 0) visit(pixel - 1);
    if (x < width - 1) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel < pixels - width) visit(pixel + width);
  }

  const removedRatio = tail / pixels;
  if (removedRatio < 0.015 || removedRatio > 0.96) return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const isRemoved = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && states[y * width + x] === 1;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    if (states[pixel] === 1) { data[offset + 3] = 0; continue; }
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const touchesBackground = isRemoved(x - 1, y) || isRemoved(x + 1, y) || isRemoved(x, y - 1) || isRemoved(x, y + 1);
    if (touchesBackground) data[offset + 3] = Math.min(data[offset + 3], 205);
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 8 }).toBuffer();
}

import assert from "node:assert/strict";
import sharp from "sharp";
import { removeConnectedSimpleBackground } from "../lib/background-removal-fallback.ts";

const width = 320;
const height = 360;
const fixture = await sharp({ create: { width, height, channels: 4, background: "#ffffff" } })
  .composite([
    { input: await sharp({ create: { width: 170, height: 260, channels: 4, background: "#27517d" } }).png().toBuffer(), left: 75, top: 55 },
    { input: await sharp({ create: { width: 36, height: 36, channels: 4, background: "#ffffff" } }).png().toBuffer(), left: 142, top: 150 },
  ])
  .png()
  .toBuffer();

const result = await removeConnectedSimpleBackground(fixture);
const { data, info } = await sharp(result).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];

assert.equal(info.width, width);
assert.equal(info.height, height);
assert.ok(alphaAt(5, 5) < 20, "the connected white background should be transparent");
assert.ok(alphaAt(100, 100) > 240, "the product should stay opaque");
assert.ok(alphaAt(155, 165) > 240, "a white detail enclosed by the product should be preserved");
assert.ok((await sharp(result).stats()).entropy > 0.2, "the generated cutout should not be blank");

console.log(JSON.stringify({ ok: true, checks: 6 }, null, 2));

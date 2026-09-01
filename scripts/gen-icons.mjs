// Rasterises public/icon.svg into the PNG sizes browsers want for install.
// Run: node scripts/gen-icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync(new URL("../public/icon.svg", import.meta.url));
const targets = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/apple-touch-icon.png", 180],
];
for (const [out, size] of targets) {
  await sharp(svg, { density: 512 }).resize(size, size).png().toFile(out);
  console.log("wrote", out, `${size}x${size}`);
}

// Restore the supplied POS INVENTORY icons without changing their artwork.
// Run: npm run icons
import { copyFile } from "node:fs/promises";

const kit = new URL("../docs/POS-Inventory-Brand-Kit-1/POS-Inventory-Brand-Kit/", import.meta.url);
const targets = [
  ["source-svg/icon-mark.svg", "public/icon.svg"],
  ["source-svg/icon-mark.svg", "src/app/icon.svg"],
  // Serve the original ICO directly: Next's metadata decoder rejects its indexed PNGs.
  ["favicon/favicon.ico", "public/favicon.ico"],
  ["favicon/android-chrome-192.png", "public/icon-192.png"],
  ["favicon/android-chrome-512.png", "public/icon-512.png"],
  ["favicon/apple-touch-icon-180.png", "public/apple-touch-icon.png"],
  ["app-icons/android/maskable-icon-512.png", "public/icon-maskable-512.png"],
];
for (const [source, output] of targets) {
  await copyFile(new URL(source, kit), new URL(`../${output}`, import.meta.url));
  console.log("Restored", output);
}

import Image from "next/image";
import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

const artwork = {
  horizontal: { src: "/brand/logo-horizontal-dark.svg", width: 1620, height: 300, displayWidth: 300 },
  wordmark: { src: "/brand/wordmark-dark.svg", width: 1274, height: 198, displayWidth: 148 },
  mark: { src: "/brand/icon-mark.svg", width: 512, height: 512, displayWidth: 32 },
};

/** Original outlined artwork from the supplied POS INVENTORY brand kit. */
export function BrandLogo({
  variant = "horizontal",
  className,
}: {
  variant?: keyof typeof artwork;
  className?: string;
}) {
  const asset = artwork[variant];
  return (
    <Image
      src={asset.src}
      alt={BRAND_NAME}
      width={asset.displayWidth}
      height={Math.round(asset.displayWidth * asset.height / asset.width)}
      unoptimized
      className={cn("h-auto shrink-0", className)}
    />
  );
}

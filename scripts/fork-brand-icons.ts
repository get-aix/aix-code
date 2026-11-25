#!/usr/bin/env node

// Fork branding: Icon Composer only runs on macOS, so this re-renders each variant's interior
// (background layers plus the `text.svg` mark) into the tracked iOS and macOS exports and keeps
// their native silhouette, rim, and shadow. Every web, favicon, and ICO rendition derives from the
// iOS master, as `export-brand-icons.ts` does. Rerun after changing a layer SVG.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

type Variant = "dev" | "nightly" | "prod";

const CANVAS = 1024;
const LAYER_BOX = 128;
const TEXT_SCALE = 8.5;
const BACKGROUND_SCALE = 8.1;
const RIM_PX = 18;
const SVG_DENSITY = 300;

export class ForkIconRenderError extends Schema.TaggedError<ForkIconRenderError>()(
  "ForkIconRenderError",
  { step: Schema.String, cause: Schema.Defect() },
) {}

const LAYER_FILES = [
  "prod/app-icon.icon/Assets/text.svg",
  "dev/app-icon.icon/Assets/background.svg",
  "dev/app-icon.icon/Assets/annotations.svg",
  "nightly/app-icon.icon/Assets/background.svg",
  "nightly/app-icon.icon/Assets/cloud-lower-left.svg",
  "nightly/app-icon.icon/Assets/cloud-upper-right.svg",
] as const;

// Rendering is pure: every source is read up front and every output written afterwards.
interface Sources {
  readonly layers: ReadonlyMap<string, string>;
  readonly exports: ReadonlyMap<string, Buffer>;
}

const OUTPUTS = {
  dev: {
    ios: BRAND_ASSET_PATHS.developmentIosIconPng,
    universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
    mac: BRAND_ASSET_PATHS.developmentDesktopIconPng,
    windowsIco: BRAND_ASSET_PATHS.developmentWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    icon192: BRAND_ASSET_PATHS.developmentWebIcon192Png,
    icon512: BRAND_ASSET_PATHS.developmentWebIcon512Png,
  },
  nightly: {
    ios: BRAND_ASSET_PATHS.nightlyIosIconPng,
    universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
    mac: BRAND_ASSET_PATHS.nightlyMacIconPng,
    windowsIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
    icon192: BRAND_ASSET_PATHS.nightlyWebIcon192Png,
    icon512: BRAND_ASSET_PATHS.nightlyWebIcon512Png,
  },
  prod: {
    ios: BRAND_ASSET_PATHS.productionIosIconPng,
    universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
    mac: BRAND_ASSET_PATHS.productionMacIconPng,
    windowsIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    icon192: BRAND_ASSET_PATHS.productionWebIcon192Png,
    icon512: BRAND_ASSET_PATHS.productionWebIcon512Png,
  },
} as const satisfies Record<Variant, Record<string, string>>;

// `apply-web-brand-assets.ts` copies these into `apps/web/public` for the dev server.
const WEB_PUBLIC_COPIES = [
  ["favicon.ico", "faviconIco"],
  ["favicon-16x16.png", "favicon16"],
  ["favicon-32x32.png", "favicon32"],
  ["apple-touch-icon.png", "appleTouch"],
  ["icon-192x192.png", "icon192"],
  ["icon-512x512.png", "icon512"],
] as const;

const readLayer = (sources: Sources, variant: Variant, file: string) => {
  const contents = sources.layers.get(`${variant}/app-icon.icon/Assets/${file}`);
  if (contents === undefined) throw new Error(`Missing layer ${variant}/${file}`);
  return contents;
};

// Remove the 10pt corner clip; the existing export's silhouette masks the result instead.
const fullBleed = (svg: string) =>
  svg.replace(/<rect width="128" height="128" rx="10"\/>/, '<rect width="128" height="128"/>');

const canvasSvg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">${inner}</svg>`;

const rasterize = (svg: string, width = CANVAS, height = width) =>
  sharp(Buffer.from(svg), { density: SVG_DENSITY }).resize(width, height).png().toBuffer();

// Rasterizes one layer SVG on its own (shared defs ids break when inlined) and places it like
// Icon Composer: centered on the canvas, scaled in points, offset by its translation.
async function placeLayer(
  svg: string,
  scale: number,
  translation: readonly [number, number] = [0, 0],
  box: readonly [number, number] = [LAYER_BOX, LAYER_BOX],
) {
  const width = Math.round(box[0] * scale);
  const height = Math.round(box[1] * scale);
  const left = Math.round(CANVAS / 2 + translation[0] - width / 2);
  const top = Math.round(CANVAS / 2 + translation[1] - height / 2);
  const png = await rasterize(svg, width, height);
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(CANVAS, left + width);
  const y1 = Math.min(CANVAS, top + height);
  const input = await sharp(png)
    .extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 })
    .png()
    .toBuffer();
  return { input, left: x0, top: y0 };
}

async function renderBackground(sources: Sources, variant: Variant): Promise<Buffer> {
  const base = await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: "#000000" },
  })
    .png()
    .toBuffer();
  if (variant === "prod") return base;

  const background = fullBleed(readLayer(sources, variant, "background.svg"));
  const layers = [
    await placeLayer(background, BACKGROUND_SCALE, [0, variant === "nightly" ? -2.171875 : 0]),
  ];
  if (variant === "dev") {
    layers.push(await placeLayer(readLayer(sources, "dev", "annotations.svg"), TEXT_SCALE));
  } else {
    // Mirrors assets/nightly/app-icon.icon/icon.json; blur is omitted as in the Android export.
    const clouds = [
      { file: "cloud-lower-left.svg", scale: 25, translation: [-309.6375, 268.66077693836917] },
      {
        file: "cloud-upper-right.svg",
        scale: 15,
        translation: [387.9605131881942, -134.30064713259117],
      },
    ] as const;
    for (const cloud of clouds) {
      const source = readLayer(sources, "nightly", cloud.file).replace(
        / filter="url\(#soft\)"/,
        "",
      );
      layers.push(await placeLayer(source, cloud.scale, cloud.translation, [64, 32]));
    }
  }
  return sharp(base).composite(layers).png().toBuffer();
}

async function renderMark(sources: Sources): Promise<Buffer> {
  const text = readLayer(sources, "prod", "text.svg");
  const paths = (text.match(/<path[^>]*\/>/g) ?? [])
    .map((element) => element.replace(/fill="[^"]*"/, ""))
    .join("");
  // Approximates Icon Composer's glass: a top-lit fill and a soft neutral shadow.
  const defs = `<defs>
    <linearGradient id="glass" x1="0" y1="37" x2="0" y2="94" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9CBD2"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0.9" stdDeviation="1.2" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>`;
  return rasterize(
    canvasSvg(
      `${defs}<g transform="translate(${(CANVAS - LAYER_BOX * TEXT_SCALE) / 2} ${(CANVAS - LAYER_BOX * TEXT_SCALE) / 2}) scale(${TEXT_SCALE})"><g fill="url(#glass)" filter="url(#shadow)">${paths}</g></g>`,
    ),
  );
}

// The opaque body of an existing export, shrunk by the rim so its native edge highlight survives.
async function interiorMask(existing: Buffer) {
  const shrunk = await sharp(existing)
    .extractChannel("alpha")
    .threshold(254)
    .blur(RIM_PX / 2)
    .threshold(250)
    .png()
    .toBuffer();
  const { data, info } = await sharp(shrunk)
    .blur(1)
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, raw: { width: info.width, height: info.height, channels: 1 as const } };
}

async function replaceInterior(
  existing: Buffer,
  interior: Buffer,
  bodySize: number,
): Promise<Buffer> {
  const { width = CANVAS, height = CANVAS } = await sharp(existing).metadata();
  const inset = Math.round((width - bodySize) / 2);
  const placed = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await sharp(interior).resize(bodySize, bodySize).png().toBuffer(),
        left: inset,
        top: inset,
      },
    ])
    .png()
    .toBuffer();
  const mask = await interiorMask(existing);
  // sharp applies removeAlpha at output, after joinChannel, so strip alpha in its own pipeline.
  const rgb = await sharp(placed).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const masked = await sharp(rgb.data, {
    raw: { width: rgb.info.width, height: rgb.info.height, channels: 3 },
  })
    .joinChannel(mask.data, { raw: mask.raw })
    .png()
    .toBuffer();
  return sharp(existing)
    .composite([{ input: masked }])
    .png()
    .toBuffer();
}

const resize = (master: Buffer, size: number) =>
  sharp(master).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();

async function renderVariant(sources: Sources, variant: Variant, mark: Buffer) {
  const outputs = OUTPUTS[variant];
  const existing = (relativePath: string) => {
    const contents = sources.exports.get(relativePath);
    if (contents === undefined) throw new Error(`Missing export ${relativePath}`);
    return contents;
  };
  const interior = await sharp(await renderBackground(sources, variant))
    .composite([{ input: mark }])
    .png()
    .toBuffer();
  const ios = await replaceInterior(existing(outputs.ios), interior, CANVAS);
  const mac = await replaceInterior(existing(outputs.mac), interior, 824);
  const ico = encodePngIco(
    await Promise.all(
      WINDOWS_ICON_SIZES.map(async (size) => ({ size, contents: await resize(ios, size) })),
    ),
  );
  const files: Array<readonly [string, Buffer]> = [
    [outputs.ios, ios],
    [outputs.universal, ios],
    [outputs.mac, mac],
    [outputs.appleTouch, await resize(ios, 180)],
    [outputs.icon192, await resize(ios, 192)],
    [outputs.icon512, await resize(ios, 512)],
    [outputs.favicon16, await resize(ios, 16)],
    [outputs.favicon32, await resize(ios, 32)],
    [outputs.faviconIco, ico],
    [outputs.windowsIco, ico],
  ];
  if (variant === "dev") {
    for (const [target, key] of WEB_PUBLIC_COPIES) {
      const source = files.find(([relativePath]) => relativePath === outputs[key]);
      if (source) files.push([`apps/web/public/${target}`, source[1]]);
    }
  }
  return files;
}

// Android's monochrome launcher layer and status-bar icon are flat white silhouettes of the mark.
const FLAT_MARKS = [
  { file: "apps/mobile/assets/android-icon-mark.png", size: 432, left: 76, top: 130, width: 279 },
  {
    file: "apps/mobile/assets/android-notification-icon.png",
    size: 96,
    left: 16,
    top: 28,
    width: 64,
  },
] as const;

async function renderFlatMarks(sources: Sources) {
  const text = readLayer(sources, "prod", "text.svg");
  const paths = (text.match(/<path[^>]*\/>/g) ?? []).join("");
  const files: Array<readonly [string, Buffer]> = [];
  for (const mark of FLAT_MARKS) {
    const scale = mark.width / 94.5;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${mark.size}" height="${mark.size}" viewBox="0 0 ${mark.size} ${mark.size}"><g transform="translate(${mark.left - 15.53 * scale} ${mark.top - 37 * scale}) scale(${scale})">${paths}</g></svg>`;
    files.push([mark.file, await rasterize(svg, mark.size)]);
  }
  return files;
}

async function renderAll(sources: Sources) {
  const files = await renderFlatMarks(sources);
  const mark = await renderMark(sources);
  for (const variant of ["dev", "nightly", "prod"] as const) {
    files.push(...(await renderVariant(sources, variant, mark)));
  }
  return files;
}

const exportForkBrandIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const fromRoot = (relativePath: string) => path.join(repositoryRoot, relativePath);
  const layers = new Map<string, string>();
  for (const file of LAYER_FILES) {
    layers.set(file, yield* fs.readFileString(fromRoot(`assets/${file}`)));
  }
  const exports = new Map<string, Buffer>();
  for (const outputs of Object.values(OUTPUTS)) {
    for (const relativePath of [outputs.ios, outputs.mac]) {
      exports.set(relativePath, Buffer.from(yield* fs.readFile(fromRoot(relativePath))));
    }
  }
  const files = yield* Effect.tryPromise({
    try: () => renderAll({ layers, exports }),
    catch: (cause) => new ForkIconRenderError({ step: "render", cause }),
  });
  for (const [relativePath, contents] of files) {
    yield* fs.writeFile(fromRoot(relativePath), contents);
    yield* Console.log(`wrote ${relativePath}`);
  }
});

if (import.meta.main) {
  exportForkBrandIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const sourcePath = path.join(ROOT, 'frontend', 'images', 'guest_avatars.png');
const outputDir = path.join(ROOT, 'frontend', 'images', 'animals');

const OUTPUT_NAMES = [
  'chicken.png',
  'raccoon.png',
  'dino.png',
  'horse.png',
  'sheep.png',
  'fox.png',
  'pig.png',
  'koala.png',
  'bird.png',
  'bunny.png',
  'hedgehog.png',
  'cow.png',
  'chick.png',
  'bear.png',
  'dog.png',
];

function pixelAt(png, x, y) {
  const i = (png.width * y + x) << 2;
  return {
    r: png.data[i],
    g: png.data[i + 1],
    b: png.data[i + 2],
    a: png.data[i + 3],
  };
}

function isForeground(px) {
  if (px.a < 15) return false;
  return !(px.r > 240 && px.g > 240 && px.b > 240);
}

function isNearWhite(px) {
  if (px.a < 15) return true;
  return px.r > 240 && px.g > 236 && px.b > 230;
}

function extractGridBoxes(png, columns, rows) {
  const boxes = [];
  const cellW = png.width / columns;
  const cellH = png.height / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const startX = Math.floor(col * cellW);
      const endX = Math.ceil((col + 1) * cellW) - 1;
      const startY = Math.floor(row * cellH);
      const endY = Math.ceil((row + 1) * cellH) - 1;

      let minX = endX;
      let minY = endY;
      let maxX = startX;
      let maxY = startY;
      let found = false;

      for (let y = startY; y <= endY; y += 1) {
        for (let x = startX; x <= endX; x += 1) {
          const px = pixelAt(png, x, y);
          if (!isForeground(px)) continue;
          found = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }

      if (!found) {
        throw new Error(`No foreground found in cell row ${row + 1}, col ${col + 1}`);
      }

      boxes.push({ minX, minY, maxX, maxY, startX, startY, endX, endY });
    }
  }

  return boxes;
}

function removeBorderBackgroundAlpha(png) {
  const { width, height } = png;
  const visited = new Uint8Array(width * height);
  const queue = [];

  function enqueueIfWhite(x, y) {
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    const px = pixelAt(png, x, y);
    if (isNearWhite(px)) queue.push([x, y]);
  }

  for (let x = 0; x < width; x += 1) {
    enqueueIfWhite(x, 0);
    enqueueIfWhite(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueueIfWhite(0, y);
    enqueueIfWhite(width - 1, y);
  }

  const offsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  let qi = 0;
  while (qi < queue.length) {
    const [x, y] = queue[qi];
    qi += 1;
    const i = (width * y + x) << 2;
    png.data[i + 3] = 0;

    for (const [ox, oy] of offsets) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const idx = ny * width + nx;
      if (visited[idx]) continue;
      visited[idx] = 1;
      const px = pixelAt(png, nx, ny);
      if (isNearWhite(px)) queue.push([nx, ny]);
    }
  }
}

function removeSmallIslands(png) {
  const { width, height } = png;
  const alphaThreshold = 10;
  const visited = new Uint8Array(width * height);
  const keep = new Uint8Array(width * height);
  const components = [];

  const offsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  function alphaAt(x, y) {
    const i = (width * y + x) << 2;
    return png.data[i + 3];
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      if (alphaAt(x, y) <= alphaThreshold) continue;

      const queue = [[x, y]];
      const pixels = [];
      let touchesBorder = false;
      visited[idx] = 1;
      let qi = 0;

      while (qi < queue.length) {
        const [cx, cy] = queue[qi];
        qi += 1;
        const cIdx = cy * width + cx;
        pixels.push(cIdx);
        if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) {
          touchesBorder = true;
        }

        for (const [ox, oy] of offsets) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx]) continue;
          visited[nIdx] = 1;
          if (alphaAt(nx, ny) <= alphaThreshold) continue;
          queue.push([nx, ny]);
        }
      }

      components.push({ pixels, touchesBorder });
    }
  }

  const maxArea = components.reduce((m, comp) => Math.max(m, comp.pixels.length), 0);
  const minKeepArea = Math.max(250, Math.floor(maxArea * 0.06));

  for (const comp of components) {
    const area = comp.pixels.length;
    if (area < minKeepArea) continue;
    if (comp.touchesBorder && area < Math.floor(maxArea * 0.5)) continue;
    for (const idx of comp.pixels) keep[idx] = 1;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!keep[idx]) {
        const i = idx << 2;
        png.data[i + 3] = 0;
      }
    }
  }
}

function cropRegion(sourcePng, box, pad = 12) {
  // Clamp inside each grid cell so neighboring animals can never leak into the crop.
  const sx = Math.max(box.startX, box.minX - pad);
  const sy = Math.max(box.startY, box.minY - pad);
  const ex = Math.min(box.endX, box.maxX + pad);
  const ey = Math.min(box.endY, box.maxY + pad);

  const width = ex - sx + 1;
  const height = ey - sy + 1;
  const out = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const srcIdx = ((sy + y) * sourcePng.width + (sx + x)) << 2;
      const outIdx = (y * width + x) << 2;
      out.data[outIdx] = sourcePng.data[srcIdx];
      out.data[outIdx + 1] = sourcePng.data[srcIdx + 1];
      out.data[outIdx + 2] = sourcePng.data[srcIdx + 2];
      out.data[outIdx + 3] = sourcePng.data[srcIdx + 3];
    }
  }

  removeBorderBackgroundAlpha(out);
  removeSmallIslands(out);
  return out;
}

function clearRectAlpha(png, x1, y1, x2, y2) {
  const sx = Math.max(0, Math.floor(x1));
  const sy = Math.max(0, Math.floor(y1));
  const ex = Math.min(png.width - 1, Math.floor(x2));
  const ey = Math.min(png.height - 1, Math.floor(y2));

  for (let y = sy; y <= ey; y += 1) {
    for (let x = sx; x <= ex; x += 1) {
      const i = (png.width * y + x) << 2;
      png.data[i + 3] = 0;
    }
  }
}

function applyManualCleanup(sprite, fileName) {
  if (fileName === 'koala.png') {
    // Removes a persistent neighbor-stroke artifact on the far left edge.
    clearRectAlpha(sprite, 0, 0, sprite.width * 0.11, sprite.height - 1);
  }
}

function getAlphaBounds(png, alphaThreshold = 10) {
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (png.width * y + x) << 2;
      if (png.data[i + 3] <= alphaThreshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0 || maxY < 0) return null;
  return { minX, minY, maxX, maxY };
}

function centerSpriteOnCanvas(sprite, canvasSize) {
  const bounds = getAlphaBounds(sprite);
  const out = new PNG({ width: canvasSize, height: canvasSize });

  if (!bounds) return out;

  const contentWidth = bounds.maxX - bounds.minX + 1;
  const contentHeight = bounds.maxY - bounds.minY + 1;
  const offsetX = Math.floor((canvasSize - contentWidth) / 2);
  const offsetY = Math.floor((canvasSize - contentHeight) / 2);

  for (let y = 0; y < contentHeight; y += 1) {
    for (let x = 0; x < contentWidth; x += 1) {
      const srcIdx = ((bounds.minY + y) * sprite.width + (bounds.minX + x)) << 2;
      const dstIdx = ((offsetY + y) * out.width + (offsetX + x)) << 2;
      out.data[dstIdx] = sprite.data[srcIdx];
      out.data[dstIdx + 1] = sprite.data[srcIdx + 1];
      out.data[dstIdx + 2] = sprite.data[srcIdx + 2];
      out.data[dstIdx + 3] = sprite.data[srcIdx + 3];
    }
  }

  return out;
}

function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source not found: ${sourcePath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  fs.createReadStream(sourcePath)
    .pipe(new PNG())
    .on('parsed', function parsed() {
      const components = extractGridBoxes(this, 5, 3).slice(0, OUTPUT_NAMES.length);

      if (components.length !== OUTPUT_NAMES.length) {
        throw new Error(`Expected ${OUTPUT_NAMES.length} animals, found ${components.length}`);
      }

      const rawSprites = components.map((box, idx) => {
        const outName = OUTPUT_NAMES[idx];
        const sprite = cropRegion(this, box);
        applyManualCleanup(sprite, outName);
        return sprite;
      });

      const contentBounds = rawSprites.map((sprite) => getAlphaBounds(sprite));
      const maxContentDimension = contentBounds.reduce((max, bounds) => {
        if (!bounds) return max;
        const w = bounds.maxX - bounds.minX + 1;
        const h = bounds.maxY - bounds.minY + 1;
        return Math.max(max, w, h);
      }, 0);
      const canvasPadding = 24;
      const unifiedCanvasSize = maxContentDimension + canvasPadding * 2;

      rawSprites.forEach((sprite, idx) => {
        const centered = centerSpriteOnCanvas(sprite, unifiedCanvasSize);
        const outPath = path.join(outputDir, OUTPUT_NAMES[idx]);
        fs.writeFileSync(outPath, PNG.sync.write(centered));
      });

      console.log(`Extracted ${components.length} centered animal PNG files (${unifiedCanvasSize}x${unifiedCanvasSize}) to ${outputDir}`);
    });
}

main();

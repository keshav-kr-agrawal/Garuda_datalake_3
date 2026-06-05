/**
 * CLAHEProcessor — Contrast Limited Adaptive Histogram Equalization.
 *
 * Industry-standard image pre-processing for normalizing contrast under
 * harsh lighting (direct sunlight, deep shadows, low-light).
 *
 * Algorithm:
 *   1. Divide image into NxN tiles (default: 8x8)
 *   2. Compute histogram per tile
 *   3. Apply clip limit + redistribute excess
 *   4. Build CDF per tile
 *   5. Bilinear interpolation between neighbouring tiles
 *
 * Zero external dependencies — pure TypeScript math.
 * Runs on HTML Canvas API (~4–8ms for 480×480 frame).
 *
 * @example
 * ```ts
 * import { CLAHEProcessor } from 'nhai-garuda';
 *
 * const clahe = new CLAHEProcessor(8, 3.0);
 * const latencyMs = clahe.processCanvas(canvasElement);
 * ```
 */

export class CLAHEProcessor {
  private static _instance: CLAHEProcessor | null = null;

  private readonly tileSize: number;
  private readonly clipLimit: number;
  private readonly numBins = 256;

  /**
   * @param tileSize  Size of each tile in pixels (default: 8)
   * @param clipLimit Contrast clip limit (default: 3.0)
   */
  constructor(tileSize = 8, clipLimit = 3.0) {
    this.tileSize = tileSize;
    this.clipLimit = clipLimit;
  }

  /** Backward-compatible singleton. */
  public static getInstance(): CLAHEProcessor {
    if (!CLAHEProcessor._instance) {
      CLAHEProcessor._instance = new CLAHEProcessor(8, 3.0);
    }
    return CLAHEProcessor._instance;
  }

  public static resetInstance(): void {
    CLAHEProcessor._instance = null;
  }

  /**
   * Apply CLAHE to an HTMLCanvasElement in-place.
   * @returns latencyMs — processing time in milliseconds
   */
  public processCanvas(canvas: HTMLCanvasElement): number {
    const t0 = performance.now();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;

    const w = canvas.width;
    const h = canvas.height;

    const imageData = ctx.getImageData(0, 0, w, h);
    this.applyToImageData(imageData, w, h);
    ctx.putImageData(imageData, 0, 0);

    return performance.now() - t0;
  }

  /**
   * Apply CLAHE to raw ImageData. Mutates the data buffer in-place.
   * Can be used with node-canvas or OffscreenCanvas in workers.
   */
  public applyToImageData(imageData: ImageData, width: number, height: number): void {
    const data = imageData.data;

    // Step 1: Extract luminance (BT.601)
    const luma = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      luma[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    }

    // Step 2: Tile grid dimensions
    const tilesX = Math.ceil(width / this.tileSize);
    const tilesY = Math.ceil(height / this.tileSize);
    const totalTiles = tilesX * tilesY;

    // Step 3: Per-tile histogram + CDF
    const cdfs: Float32Array[] = new Array(totalTiles);

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const hist = new Uint32Array(this.numBins);

        const x0 = tx * this.tileSize;
        const y0 = ty * this.tileSize;
        const x1 = Math.min(x0 + this.tileSize, width);
        const y1 = Math.min(y0 + this.tileSize, height);
        const pixCount = (x1 - x0) * (y1 - y0);

        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            hist[luma[y * width + x]]++;
          }
        }

        // Step 4: Clip + redistribute
        const clipLimitVal = Math.max(1, Math.round((this.clipLimit * pixCount) / this.numBins));
        let excess = 0;
        for (let i = 0; i < this.numBins; i++) {
          if (hist[i] > clipLimitVal) {
            excess += hist[i] - clipLimitVal;
            hist[i] = clipLimitVal;
          }
        }
        const uniformAdd = (excess / this.numBins) | 0;
        let leftover = excess % this.numBins;
        for (let i = 0; i < this.numBins; i++) {
          hist[i] += uniformAdd;
          if (leftover-- > 0) hist[i]++;
        }

        // Step 5: CDF normalized to [0, 255]
        const cdf = new Float32Array(this.numBins);
        let cumSum = 0;
        let cdfMin = -1;
        for (let i = 0; i < this.numBins; i++) {
          cumSum += hist[i];
          cdf[i] = cumSum;
          if (cdfMin < 0 && cumSum > 0) cdfMin = cumSum;
        }
        const normFactor = 255 / Math.max(1, pixCount - (cdfMin < 0 ? 0 : cdfMin));
        for (let i = 0; i < this.numBins; i++) {
          cdf[i] = Math.max(0, Math.min(255, Math.round((cdf[i] - (cdfMin < 0 ? 0 : cdfMin)) * normFactor)));
        }

        cdfs[ty * tilesX + tx] = cdf;
      }
    }

    // Step 6: Bilinear interpolation
    const enhanced = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const val = luma[y * width + x];

        const txf = (x - this.tileSize * 0.5) / this.tileSize;
        const tyf = (y - this.tileSize * 0.5) / this.tileSize;

        const tx0 = Math.max(0, Math.min(tilesX - 1, Math.floor(txf)));
        const tx1 = Math.min(tilesX - 1, tx0 + 1);
        const ty0 = Math.max(0, Math.min(tilesY - 1, Math.floor(tyf)));
        const ty1 = Math.min(tilesY - 1, ty0 + 1);

        const fx = Math.max(0, Math.min(1, txf - Math.floor(txf)));
        const fy = Math.max(0, Math.min(1, tyf - Math.floor(tyf)));

        const v00 = cdfs[ty0 * tilesX + tx0][val];
        const v10 = cdfs[ty0 * tilesX + tx1][val];
        const v01 = cdfs[ty1 * tilesX + tx0][val];
        const v11 = cdfs[ty1 * tilesX + tx1][val];

        enhanced[y * width + x] =
          (v00 * (1 - fx) * (1 - fy) +
           v10 * fx       * (1 - fy) +
           v01 * (1 - fx) * fy +
           v11 * fx       * fy) | 0;
      }
    }

    // Step 7: Write enhanced luminance back (preserve hue)
    for (let i = 0; i < width * height; i++) {
      const origLuma = luma[i];
      if (origLuma === 0) continue;

      const scale = enhanced[i] / origLuma;
      data[i * 4]     = Math.min(255, (data[i * 4]     * scale) | 0);
      data[i * 4 + 1] = Math.min(255, (data[i * 4 + 1] * scale) | 0);
      data[i * 4 + 2] = Math.min(255, (data[i * 4 + 2] * scale) | 0);
    }
  }
}

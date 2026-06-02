#include <jni.h>
#include <vector>
#include <cmath>
#include <algorithm>

#ifdef __ARM_NEON
#include <arm_neon.h>
#endif

/**
 * NHAI Offline Face Recognition & Liveness System
 * Custom Contrast Limited Adaptive Histogram Equalization (CLAHE) C++ Pipeline.
 * 
 * Optimized for ARM NEON architecture (standard mid-range highway deployment profiles).
 * Processes image buffer tiles to limit local contrast stretching and blow-out under extreme sun/canopy glare.
 */

class CLAHEProcessor {
public:
    static void applyCLAHE(
        uint8_t* src, 
        uint8_t* dst, 
        int width, 
        int height, 
        int gridX = 8, 
        int gridY = 8, 
        float clipLimit = 2.0f,
        int bins = 256
    ) {
        int tileSizeX = width / gridX;
        int tileSizeY = height / gridY;
        int totalPixels = tileSizeX * tileSizeY;

        // Calculate clip limit count
        int clipCount = static_cast<int>(clipLimit * (totalPixels / bins));
        clipCount = std::max(clipCount, 1);

        // Pre-allocate local histograms for all grid tiles
        std::vector<std::vector<int>> histograms(gridX * gridY, std::vector<int>(bins, 0));

        // 1. Calculate Local Histograms per Tile
        for (int gy = 0; gy < gridY; ++gy) {
            for (int gx = 0; gx < gridX; ++gx) {
                int tileIdx = gy * gridX + gx;
                int startX = gx * tileSizeX;
                int startY = gy * tileSizeY;

                for (int y = 0; y < tileSizeY; ++y) {
                    int posY = startY + y;
                    if (posY >= height) continue;
                    
                    int rowOffset = posY * width;
                    for (int x = 0; x < tileSizeX; ++x) {
                        int posX = startX + x;
                        if (posX >= width) continue;

                        uint8_t val = src[rowOffset + posX];
                        histograms[tileIdx][val]++;
                    }
                }

                // Apply Contrast Clipping and Uniform Redistribution
                int clippedCount = 0;
                for (int b = 0; b < bins; ++b) {
                    if (histograms[tileIdx][b] > clipCount) {
                        clippedCount += (histograms[tileIdx][b] - clipCount);
                        histograms[tileIdx][b] = clipCount;
                    }
                }

                int redistValue = clippedCount / bins;
                int remainder = clippedCount % bins;

                #ifdef __ARM_NEON
                // NEON-accelerated uniform redistribution for 256 bins (64 floats or 32-bit ints at a time)
                int32x4_t redistVec = vdupq_n_s32(redistValue);
                for (int b = 0; b < bins; b += 4) {
                    int32x4_t histVec = vld1q_s32(&histograms[tileIdx][b]);
                    histVec = vaddq_s32(histVec, redistVec);
                    vst1q_s32(&histograms[tileIdx][b], histVec);
                }
                #else
                for (int b = 0; b < bins; ++b) {
                    histograms[tileIdx][b] += redistValue;
                }
                #endif

                // Distribute remainder
                for (int b = 0; b < remainder; ++b) {
                    histograms[tileIdx][b]++;
                }

                // Convert to CDF (Cumulative Distribution Function)
                int sum = 0;
                for (int b = 0; b < bins; ++b) {
                    sum += histograms[tileIdx][b];
                    // Map normalized float representation [0, 255]
                    histograms[tileIdx][b] = std::min(255, (sum * 255) / totalPixels);
                }
            }
        }

        // 2. Bilinear Interpolation over tile boundaries
        for (int y = 0; y < height; ++y) {
            float ty = (static_cast<float>(y) - tileSizeY / 2.0f) / tileSizeY;
            int ty0 = std::max(0, static_cast<int>(floor(ty)));
            int ty1 = std::min(gridY - 1, ty0 + 1);
            float ay = ty - ty0;

            int rowOffset = y * width;

            for (int x = 0; x < width; ++x) {
                float tx = (static_cast<float>(x) - tileSizeX / 2.0f) / tileSizeX;
                int tx0 = std::max(0, static_cast<int>(floor(tx)));
                int tx1 = std::min(gridX - 1, tx0 + 1);
                float ax = tx - tx0;

                uint8_t val = src[rowOffset + x];

                // Interpolate cumulative distribution mappings from 4 adjacent tiles
                int cdf00 = histograms[ty0 * gridX + tx0][val];
                int cdf01 = histograms[ty0 * gridX + tx1][val];
                int cdf10 = histograms[ty1 * gridX + tx0][val];
                int cdf11 = histograms[ty1 * gridX + tx1][val];

                // Bilinear formula: 
                // I(x, y) = (1-ay)*((1-ax)*cdf00 + ax*cdf01) + ay*((1-ax)*cdf10 + ax*cdf11)
                float interpolated = (1.0f - ay) * ((1.0f - ax) * cdf00 + ax * cdf01) + 
                                     ay * ((1.0f - ax) * cdf10 + ax * cdf11);

                dst[rowOffset + x] = static_cast<uint8_t>(std::clamp(interpolated, 0.0f, 255.0f));
            }
        }
    }
};

extern "C"
JNIEXPORT void JNICALL
Java_com_nhai_datalake_native_CLAHEFilter_processFrame(
    JNIEnv *env, 
    jclass clazz, 
    jbyteArray srcArray, 
    jbyteArray dstArray, 
    jint width, 
    jint height
) {
    jbyte* srcData = env->GetByteArrayElements(srcArray, nullptr);
    jbyte* dstData = env->GetByteArrayElements(dstArray, nullptr);

    CLAHEProcessor::applyCLAHE(
        reinterpret_cast<uint8_t*>(srcData), 
        reinterpret_cast<uint8_t*>(dstData), 
        width, 
        height
    );

    env->ReleaseByteArrayElements(srcArray, srcData, 0);
    env->ReleaseByteArrayElements(dstArray, dstData, 0);
}

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@react-native-async-storage/async-storage': path.resolve(__dirname, 'src/web-mocks/asyncStorage.ts'),
      '@react-native-community/netinfo': path.resolve(__dirname, 'src/web-mocks/netinfo.ts'),
      'react-native-reanimated': path.resolve(__dirname, 'src/web-mocks/react-native-reanimated.ts'),
      'react-native-vision-camera': path.resolve(__dirname, 'src/web-mocks/react-native-vision-camera.ts'),
      'react-native-fast-tflite': path.resolve(__dirname, 'src/web-mocks/react-native-fast-tflite.ts'),
      'react-native-safe-area-context': path.resolve(__dirname, 'src/web-mocks/react-native-safe-area-context.ts'),
      'react-native': path.resolve(__dirname, 'src/web-mocks/react-native.ts'),
    },
  },
  server: {
    port: 5173,
    open: true,
    headers: {
      // Required for SharedArrayBuffer used by WASM SIMD multi-threading
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    // These are loaded as global <script> tags — exclude from Vite pre-bundling
    // to avoid Node.js-only internal module resolution failures
    exclude: ['@tensorflow/tfjs', '@tensorflow/tfjs-tflite'],
  },
  // Ensure binary model files pass through as static assets (not processed by Vite)
  assetsInclude: ['**/*.tflite', '**/*.binarypb', '**/*.data'],
});

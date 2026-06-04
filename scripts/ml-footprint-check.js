const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modelFiles = [
  'android/app/src/main/assets/face_mesh.tflite',
  'android/app/src/main/assets/mobile_facenet.tflite',
  'src/assets/models/face_mesh.tflite',
  'src/assets/models/mobile_facenet.tflite',
  'public/face_mesh.tflite',
  'public/mobile_facenet.tflite',
];

const requiredAndroid = modelFiles.slice(0, 2);
const mobileBudgetBytes = 20 * 1024 * 1024;

function sizeOf(relPath) {
  const absPath = path.join(root, relPath);
  if (!fs.existsSync(absPath)) {
    return null;
  }
  return fs.statSync(absPath).size;
}

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

let androidTotal = 0;
let failed = false;

console.log('NHAI Garuda ML Footprint Check');
console.log('--------------------------------');

for (const relPath of modelFiles) {
  const bytes = sizeOf(relPath);
  if (bytes === null) {
    console.log(`MISSING  ${relPath}`);
    if (requiredAndroid.includes(relPath)) failed = true;
    continue;
  }

  if (requiredAndroid.includes(relPath)) {
    androidTotal += bytes;
  }

  console.log(`OK       ${relPath}  ${formatMiB(bytes)}`);
}

console.log('--------------------------------');
console.log(`Android bundled ML total: ${formatMiB(androidTotal)} / ${formatMiB(mobileBudgetBytes)}`);

if (androidTotal > mobileBudgetBytes) {
  console.error('FAIL     Android ML assets exceed the 20 MiB hackathon target.');
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('PASS     ML footprint is within the hackathon target.');
}

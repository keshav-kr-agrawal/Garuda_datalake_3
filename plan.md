# NHAI Hackathon 7.0: Project Plan
## Offline Facial Recognition & Liveness Detection System (Zero-Network Zone)

**Role:** Principal Engineering Lead & Project Manager  
**Sprint Duration:** 24 Hours  
**Target Device Profile:** Mid-range Android/iOS (e.g., Snapdragon 680 / Helio G85, 4-6GB RAM)  
**Target Environment:** Zero-connectivity remote tollways, highway checkpoints, and national corridors.

---

## 1. Project Manifesto & Constraints

Operating in remote Indian transit corridors requires extreme architectural discipline. We are not building a cloud-reliant web wrapper; we are deploying a high-performance computer vision and cryptographic pipeline directly to edge silicon.

### Core Engineering Objectives
*   **100% Offline Autonomy:** Absolutely zero reliance on external network sockets during the primary identification loop.
*   **Latency Budget ($< 1.0\text{s}$):**
    *   Frame Pre-processing: $< 50\text{ms}$
    *   Landmark Detection (Liveness): $< 150\text{ms}$
    *   Face Embedding Generation: $< 300\text{ms}$
    *   Vector DB Index Lookup: $< 50\text{ms}$
    *   Total Budget: $\le 550\text{ms}$ average execution time, allowing a comfortable buffer below the 1.0s limit.
*   **Footprint Budget ($< 20\text{MB}$ total binary size):**
    *   Quantized MediaPipe Face Mesh model: $\approx 2.7\text{MB}$ (int8 quantized).
    *   Quantized MobileFaceNet embedding model: $\approx 5.2\text{MB}$ (int8 quantized).
    *   ObjectBox/WatermelonDB Native C-libraries: $\approx 3.5\text{MB}$.
    *   Application Bundle (JS engine, React Native runtime, assets): $\approx 8.0\text{MB}$.
    *   Total Native Footprint: $\approx 19.4\text{MB}$ (strict enforcement).

### Tech Stack Specification

```mermaid
graph TD
    A[Camera Feed: react-native-vision-camera] -->|Frame Processor C++| B[Highway-Hardened CLAHE Pre-processing]
    B -->|Pre-processed Float32 Array| C[react-native-fast-tflite Engine]
    C -->|Sub-Pipeline 1| D[MediaPipe Face Mesh int8]
    C -->|Sub-Pipeline 2| E[MobileFaceNet int8]
    D -->|468 3D Landmarks| F[Mathematical Liveness Module: EAR + Euler angles]
    E -->|128-D Quantized Vector| G[Cosine Similarity Engine]
    F -->|If Valid| G
    G -->|Search/Insert| H[ObjectBox Offline Vector DB]
    H -->|Queue Unsynced Record| I[SHA-256 Cryptographic Chain Ledger]
    I -->|Background Job| J[AWS Sync/Purge Service]
```

*   **Runtime:** Bare React Native (v0.74+) using Hermes engine for optimized memory footprint and instant startup.
*   **Camera & Frame Processor:** `react-native-vision-camera` (v4.x) utilizing native Worklets for zero-copy C++ array access to video buffers.
*   **Inference Engine:** `react-native-fast-tflite` providing direct JNI/C++ bindings to the TensorFlow Lite GPU delegate or NNAPI (Android) / Metal (iOS).
*   **Liveness Model:** MediaPipe Face Mesh (quantized to 8-bit integer) to yield 468 3D landmark points.
*   **Recognition Model:** MobileFaceNet (int8 quantized), trained with ArcFace loss, outputting a highly discriminative 128-dimensional float32 vector representation of the face.
*   **Local Vector DB:** ObjectBox (React Native bindings) or WatermelonDB. ObjectBox is preferred due to native flatbuffer performance and local vector search acceleration.
*   **Sync Infrastructure:** AWS IoT Core / API Gateway (HTTPS POST endpoint) for atomic background batch sync and TTL-based local storage purging.

---

## 2. The 3 Core USPs (Our Winning Edge)

### USP 1: Cryptographic Queuing & Tamper-Proof Ledger
To prevent rogue operators from injecting synthetic records directly into the local database while offline, we treat the local transaction log as a hash-chained ledger (a micro-blockchain). 

Every local transaction $L_n$ generates a block defined as:
$$H_n = \text{SHA-256}(H_{n-1} \parallel T_n \parallel \text{User\_ID}_n \parallel \text{Lat}_n \parallel \text{Lon}_n \parallel \text{Confidence}_n)$$

*   Where $H_{n-1}$ is the cryptographic signature of the preceding log.
*   Where $T_n$ is the monotonic epoch timestamp.
*   $\text{Lat}_n, \text{Lon}_n$ are the GPS coordinates obtained via hardware fusion.
*   If a malicious user attempts to insert or modify a record retroactively, the hash chain breaks instantly, and the AWS Sync pipeline rejects the entire batch upon reconnection.

### USP 2: "Highway-Hardened" Frame Pre-Processing (CLAHE)
Indian toll checkpoints present extreme lighting anomalies: harsh direct overhead sunlight, deep canopy shadows, and high-beam headlamps. Standard global histogram equalization causes artifact blowing. 

We implement **Contrast Limited Adaptive Histogram Equalization (CLAHE)** at the native frame-processor level before feeding the tensor to the neural networks:
1.  Divide the frame into $8 \times 8$ non-overlapping contextual regions (tiles).
2.  Calculate the local histogram for each tile.
3.  Clip the histogram bins exceeding a designated threshold (e.g., limit set to $0.02 \times \text{total pixels in tile}$) to limit contrast amplification in flat areas (e.g., clear skies, solid asphalt).
4.  Redistribute the clipped pixels uniformly across all bins.
5.  Perform bilinear interpolation between neighboring tile mappings to eliminate artificial boundaries.

This ensures structural consistency and prevents neural network failures under extreme shadows or glare.

### USP 3: Premium Enterprise Polish & Academic Rigor
*   **UX Experience:** Fluid $60\text{fps}$ visual indicators powered by `react-native-reanimated` (v3). An active bounding box that shifts color dynamically from **Amber** (calculating liveness) to **Emerald** (face verified) or **Crimson** (liveness check failed).
*   **Academic Deliverable:** A formal, multi-page LaTeX technical documentation paper specifying our custom EAR algorithms, computational complexity analyses, and energy consumption profiling on mid-range ARM microarchitectures.

---

## 3. 24-Hour Sprint Timeline & Milestones

The timeline operates on a strict countdown system ($T\text{-minus}$).

```
[T-24]========================================================================[T-0]
  | T-24 to T-20 |  T-20 to T-14  |  T-14 to T-8   |  T-8 to T-4  | T-4 to T-2 | T-2 to T-0
  | Bootstrapping | Model Bridging | Liveness/CLAHE | Vector DB/Sec| Integration| LaTeX/Hardening
```

*   **T-24 to T-20 (Environment & Bridging):**
    *   Initialize React Native Bare app. Install and configure native modules (`vision-camera`, `fast-tflite`, `objectbox`).
    *   Set up physical device bridge profiles and compile empty C++ worklet frames.
*   **T-20 to T-14 (Model Bridging & Pipeline Integration):**
    *   Integrate `.tflite` model files in native assets.
    *   Validate `react-native-fast-tflite` loads MediaPipe Face Mesh and MobileFaceNet models onto hardware accelerators (NNAPI/GPU).
*   **T-14 to T-8 (Mathematical Liveness & Pre-processing Core):**
    *   Write the Eye Aspect Ratio (EAR), Mouth Aspect Ratio (MAR), and Head Pose Euler estimation math in pure JS/C++ Worklets.
    *   Implement and profile the CLAHE pre-processing filter within the camera framework.
*   **T-8 to T-4 (Local DB Vector Store & Tamper-Evident Ledger):**
    *   Build ObjectBox entity schemas with indexing for the 128-D vector embeddings.
    *   Implement the SHA-256 chain log serialization and local queue structure.
    *   Write the AWS Gateway HTTPS background sync task using `react-native-background-actions`.
*   **T-4 to T-2 (UI Polish, Micro-interactions & Integration Testing):**
    *   Connect the camera overlay to the state machine.
    *   Incorporate fluid motion indicators for face guidance (e.g., "Look Left", "Blink").
    *   Run stress test cases with simulated network drops.
*   **T-2 to T-0 (Production Hardening & System Benchmarks):**
    *   Measure CPU/GPU thermal throttling patterns on mid-range devices.
    *   Verify the final compiled `.apk` / `.ipa` is strictly under $20\text{MB}$.
    *   Compile the LaTeX technical report and generate the final pitch slides.

---

## 4. Task Delegation & Ownership

### 👥 Srujan & Vignesh: Core Architecture, Camera Bridging & Premium UI/UX
*   [ ] **Project Initialization:**
    *   Initialize React Native bare project with strict TypeScript compilation configurations.
    *   Configure system-level optimization flags in Proguard (`proguard-rules.pro`) to strip unnecessary symbols, compressing the APK size.
*   [ ] **Camera Integration:**
    *   Configure `react-native-vision-camera` (v4.x) with custom permissions, high-frame-rate settings ($30\text{fps}$ lock), and resolution constraints ($640 \times 480$ or $1280 \times 720$ max to prevent memory overflow).
    *   Implement native frame processor hooks and map them to JS worklet threads.
*   [ ] **Minimalist UI & Animations:**
    *   Design a sleek dark mode dashboard with zero external component library dependencies (strictly vanilla stylesheet definitions).
    *   Implement the dynamic facial alignment grid overlay using `react-native-reanimated` (v3). Use spring physics for frame size updates instead of linear timings to ensure a buttery premium feel.
    *   Add responsive feedback panels displaying liveness status cues (e.g., "Scanning...", "Blink Now", "Spoof Detected") with color-shifting glow states.

### 👥 Ishaan & Harshiya: Core AI Engines, Liveness Math & Embeddings
*   [ ] **Model Loading & Hardware Optimization:**
    *   Quantize the MediaPipe Face Mesh model and MobileFaceNet ArcFace model into INT8 formats using the TensorFlow Lite Optimizer (`tf.lite.TFLiteConverter`).
    *   Write model bridge loaders using `react-native-fast-tflite` to ensure hardware acceleration models compile and bind successfully on both iOS (Metal GPU) and Android (NNAPI/Hexagon DSP).
*   [ ] **Eye Aspect Ratio (EAR) Math & Landmark Logic:**
    *   Extract eye contours from the 468 landmark array returned by MediaPipe Face Mesh.
    *   Implement the EAR formula in raw TS/JS within the high-performance frame worklet:
        $$\text{EAR} = \frac{||p_2 - p_6|| + ||p_3 - p_5||}{2 ||p_1 - p_4||}$$
    *   Establish adaptive blinking threshold calibration. The baseline open-eye value must be computed dynamically during the first $500\text{ms}$ of scanning to account for different eye shapes.
    *   Write the Mouth Aspect Ratio (MAR) formula to prevent static print attack strategies.
*   [ ] **Euler Angle Pose Calculations:**
    *   Select key 3D anchor points (nose tip, chin, left/right eye corners, mouth corners) and implement a lightweight perspective projection algorithm to extract Pitch, Yaw, and Roll.
    *   Implement randomized liveness challenges (e.g., yaw threshold $> 15^{\circ}$ left, then back to center) to defeat video replay attacks.
*   [ ] **Embedding Generator & Cosine Similarity Engine:**
    *   Extract the aligned face crop, pass it to the MobileFaceNet model, and retrieve the L2-normalized 128-D vector.
    *   Write the mathematical Cosine Similarity module:
        $$\text{Similarity} = \frac{\mathbf{A} \cdot \mathbf{B}}{\|\mathbf{A}\| \|\mathbf{B}\|}$$
    *   If embeddings are properly L2-normalized, optimize the similarity check down to a pure dot product:
        $$\text{Similarity} = \sum_{i=1}^{128} A_i \cdot B_i$$
    *   Establish an empirical verification threshold (e.g., $\text{Similarity} \ge 0.72$ for match confirmation).

### 👥 Mohak & Anurag: Vector Storage, Tamper-Proof Cryptography & AWS Sync
*   [ ] **ObjectBox Local Vector Database:**
    *   Define the DB entity schemas: `User` (ID, Name, Metadata, 128-D Float Array representation of embedding) and `AuditLog` (Transaction ID, Timestamp, Location, Status, Verification Confidence, Cryptographic Hash).
    *   Build vector index search configurations in ObjectBox using Euclidean distance or Cosine distance indices to support ultra-low-latency verification against local registers of up to 10,000 enrolled personnel.
*   [ ] **SHA-256 Block-Chain Ledger:**
    *   Implement the hash-chain function in native memory. Convert transaction attributes to a rigid, deterministic JSON string:
        `payload = timestamp + user_id + latitude + longitude + status`
    *   Compute the SHA-256 hash using the previous block's hash as a salt.
    *   Persist the current transaction state along with its unique computed hash.
*   [ ] **AWS Sync & Local Database Purging Pipeline:**
    *   Design a lightweight payload synchronization module. When internet connection state transitions to active (`NetInfo` status changes), read the un-synced queue.
    *   Transmit the payload in batches via HTTPS to AWS API Gateway, which routes records to AWS DynamoDB / AWS Lambda for transaction integrity checks.
    *   Implement a strict TTL (Time to Live) clean-up task. Once a sync process is successfully acknowledged by the cloud endpoint, purge vector data older than 48 hours to conserve local disk space.

### 👥 Anshul & Saket: Native Image Pre-processing, Hardware QA & LaTeX Documentation
*   [ ] **Native Image Pre-processing (CLAHE):**
    *   Implement the Contrast Limited Adaptive Histogram Equalization (CLAHE) algorithm in a custom C++ file to bind with the frame processor.
    *   Optimize pixel iteration operations using NEON (for ARM architecture) or direct native buffer manipulation to guarantee the processing overhead stays under $30\text{ms}$ per frame.
*   [ ] **Hardware Stress Testing & Profiling:**
    *   Run continuous stress-testing profiles on target mid-range devices.
    *   Measure execution latency, battery consumption profiles, and CPU thermal throttling states during continuous 10-minute facial tracking loops.
    *   Optimize garbage collection allocations in the JS layer to maintain a steady $60\text{fps}$ and avoid frame-drop jitters.
*   [ ] **LaTeX Technical Paper & Presentation Assets:**
    *   Write the comprehensive technical paper in LaTeX format. Design a high-grade two-column academic template (analogous to CVPR/IEEE guidelines).
    *   Detail the EAR math, mathematical formulation of Euler pose estimation, the cryptographic block-chained ledger, and the local vector query speeds.
    *   Produce clean, professional presentation slide content highlighting the performance margins, architectural choices, and the mathematical proof of system robustness.

---

## 5. Strict Git Workflow

During a high-speed 24-hour sprint, code collisions can easily cost hours of engineering time. We enforce a zero-compromise version control protocol.

### 1. Branch Naming Standard
Every branch must be prefixed with the functional category:
*   `feat/<module-name>` (e.g., `feat/liveness-ear-math`, `feat/objectbox-vector-schema`)
*   `fix/<bug-desc>` (e.g., `fix/fast-tflite-ios-crash`, `fix/clahe-neon-overflow`)
*   `perf/<perf-desc>` (e.g., `perf/cosine-dot-product`)
*   `docs/<doc-desc>` (e.g., `docs/latex-architecture`)

### 2. Pull Request (PR) & Review Rules
*   **Target:** All branches branch off and target `develop`. The `main` branch is locked and reserved purely for working production tags.
*   **PR Size Limit:** Keep changes localized. Max 400 lines of code changed per PR to guarantee swift reviews.
*   **Review Quorum:** A minimum of **1 peer review approval** is required before merge.
*   **Pre-Commit Hook Integration:** Ensure your code is formatted correctly using Prettier and passes ESLint rules before submitting a pull request.
*   **Review Guidelines:**
    *   Verify that any new JS allocations within the Frame Processor are zeroed out or recycled to prevent garbage collection spikes.
    *   Ensure all new cryptographic calculations are executed off the main UI thread.

### 3. Merge Strategy
*   Enforce **Squash and Merge** on all PRs targeting `develop` to maintain a clean, linear history.
*   No developer is allowed to push directly to `develop` or `main`. All direct commits will be rejected by repository settings.

---

## 6. Mathematical Formulas for Direct Implementation

Use these equations exactly in the codebase to implement our USP mathematical engines:

### Liveness Metric: Normalized EAR
$$\text{EAR} = \frac{\sqrt{(x_{p2} - x_{p6})^2 + (y_{p2} - y_{p6})^2} + \sqrt{(x_{p3} - x_{p5})^2 + (y_{p3} - y_{p5})^2}}{2 \sqrt{(x_{p1} - x_{p4})^2 + (y_{p1} - y_{p4})^2}}$$

### Face Similarity: L2-Normalized Dot Product
Given output embeddings $\mathbf{u}, \mathbf{v} \in \mathbb{R}^{128}$ from MobileFaceNet:

1.  **L2-Normalization Step:**
    $$\hat{\mathbf{u}} = \frac{\mathbf{u}}{\|\mathbf{u}\|_2} = \frac{\mathbf{u}}{\sqrt{\sum_{i=1}^{128} u_i^2}}$$
2.  **Dot Product Similarity (Fast Inference):**
    $$\text{Sim}(\hat{\mathbf{u}}, \hat{\mathbf{v}}) = \sum_{i=1}^{128} \hat{u}_i \cdot \hat{v}_i$$

---

### Sprint Launch Checklist
- [ ] Initialize git repository and create `main` and `develop` branches.
- [ ] Push this `plan.md` to the root of the project repository.
- [ ] Srujan & Vignesh: Complete bare react-native app skeleton.
- [ ] Ishaan & Harshiya: Obtain the official MediaPipe and MobileFaceNet int8 models and verify conversion pipelines.
- [ ] Mohak & Anurag: Set up local SQLite / ObjectBox config files and verify compiler support.
- [ ] Anshul & Saket: Establish the LaTeX project workspace and outline the presentation deck layout.

**Let's get to work. Execution starts now.**

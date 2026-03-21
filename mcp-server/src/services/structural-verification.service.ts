// ═══════════════════════════════════════════════════════════════
// Structural Verification Service
// 생성 이미지와 원본 라인아트 간 구조 일치율 검증
// 에지 추출 → IoU/SSIM 비교 → 품질 점수 산출
// ═══════════════════════════════════════════════════════════════

import sharp from 'sharp';
import { createLogger } from '../utils/logger.js';

const log = createLogger('structural-verification');

// ─────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────

export interface VerificationResult {
  /** 구조 일치 점수 (0.0~1.0) */
  score: number;
  /** 에지 IoU (Intersection over Union) */
  edgeIoU: number;
  /** 픽셀 기반 SSIM 근사 */
  ssimApprox: number;
  /** 라인아트 에지 픽셀 수 */
  referenceEdgePixels: number;
  /** 생성 이미지 에지 픽셀 수 */
  generatedEdgePixels: number;
  /** 겹치는 에지 픽셀 수 */
  overlappingEdgePixels: number;
  /** 검증 통과 여부 */
  passed: boolean;
  /** 검증 메시지 */
  message: string;
}

export interface VerificationOptions {
  /** 통과 임계값 (기본: 0.4 — 구조적 유사도) */
  threshold?: number;
  /** 에지 감지 감도 (기본: 30 — 값 낮을수록 더 많은 에지 감지) */
  edgeSensitivity?: number;
  /** 비교 해상도 (기본: 512 — 성능 최적화) */
  compareResolution?: number;
  /** 에지 팽창 반경 (기본: 3 — 에지 정렬 허용 오차 px) */
  dilationRadius?: number;
}

// ─────────────────────────────────────────────────────────────────
// 에지 추출 (Sobel 필터 근사)
// ─────────────────────────────────────────────────────────────────

/**
 * 이미지 base64 → grayscale → Sobel 에지 맵 (Uint8Array)
 */
async function extractEdges(
  imageBase64: string,
  resolution: number,
  sensitivity: number,
): Promise<{ edges: Uint8Array; width: number; height: number }> {
  const buffer = Buffer.from(imageBase64, 'base64');

  // Grayscale + 리사이즈 + raw 픽셀 추출
  const { data, info } = await sharp(buffer)
    .resize(resolution, resolution, { fit: 'contain', background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixels = new Uint8Array(data);
  const edges = new Uint8Array(width * height);

  // 3x3 Sobel 필터
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      // Gx Sobel
      const gx =
        -pixels[(y - 1) * width + (x - 1)] + pixels[(y - 1) * width + (x + 1)]
        - 2 * pixels[y * width + (x - 1)] + 2 * pixels[y * width + (x + 1)]
        - pixels[(y + 1) * width + (x - 1)] + pixels[(y + 1) * width + (x + 1)];

      // Gy Sobel
      const gy =
        -pixels[(y - 1) * width + (x - 1)] - 2 * pixels[(y - 1) * width + x] - pixels[(y - 1) * width + (x + 1)]
        + pixels[(y + 1) * width + (x - 1)] + 2 * pixels[(y + 1) * width + x] + pixels[(y + 1) * width + (x + 1)];

      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edges[idx] = magnitude > sensitivity ? 255 : 0;
    }
  }

  return { edges, width, height };
}

/**
 * 라인아트 이미지(흑백)에서 에지 추출
 * 이미 흑백이므로 반전만 필요 (검은 선 = 에지)
 */
async function extractLineartEdges(
  lineartBase64: string,
  resolution: number,
): Promise<{ edges: Uint8Array; width: number; height: number }> {
  const buffer = Buffer.from(lineartBase64, 'base64');

  const { data, info } = await sharp(buffer)
    .resize(resolution, resolution, { fit: 'contain', background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixels = new Uint8Array(data);
  const edges = new Uint8Array(width * height);

  // 흑백 라인아트: 어두운 픽셀(< 128) = 에지
  for (let i = 0; i < pixels.length; i++) {
    edges[i] = pixels[i] < 128 ? 255 : 0;
  }

  return { edges, width, height };
}

// ─────────────────────────────────────────────────────────────────
// 에지 팽창 (Dilation) — 정렬 오차 허용
// ─────────────────────────────────────────────────────────────────

function dilateEdges(
  edges: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return edges;

  const dilated = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] > 0) {
        // radius 범위 내 모든 픽셀 활성화
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              if (dx * dx + dy * dy <= radius * radius) {
                dilated[ny * width + nx] = 255;
              }
            }
          }
        }
      }
    }
  }

  return dilated;
}

// ─────────────────────────────────────────────────────────────────
// SSIM 근사 (간소화 버전)
// ─────────────────────────────────────────────────────────────────

function computeSSIMApprox(
  edgesA: Uint8Array,
  edgesB: Uint8Array,
): number {
  const n = edgesA.length;
  if (n === 0) return 0;

  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;

  for (let i = 0; i < n; i++) {
    const a = edgesA[i] / 255;
    const b = edgesB[i] / 255;
    sumA += a;
    sumB += b;
    sumAB += a * b;
    sumA2 += a * a;
    sumB2 += b * b;
  }

  const meanA = sumA / n;
  const meanB = sumB / n;
  const varA = sumA2 / n - meanA * meanA;
  const varB = sumB2 / n - meanB * meanB;
  const covAB = sumAB / n - meanA * meanB;

  // SSIM 공식 (C1, C2 상수)
  const C1 = 0.01 * 0.01; // (K1*L)^2, L=1
  const C2 = 0.03 * 0.03;

  const numerator = (2 * meanA * meanB + C1) * (2 * covAB + C2);
  const denominator = (meanA * meanA + meanB * meanB + C1) * (varA + varB + C2);

  return denominator === 0 ? 1 : numerator / denominator;
}

// ─────────────────────────────────────────────────────────────────
// 메인 검증 함수
// ─────────────────────────────────────────────────────────────────

/**
 * 생성 이미지와 원본 라인아트의 구조 일치율 검증
 *
 * 1. 라인아트에서 에지 추출 (흑백 반전)
 * 2. 생성 이미지에서 Sobel 에지 추출
 * 3. 라인아트 에지를 팽창(dilation)하여 정렬 오차 허용
 * 4. IoU + SSIM 계산 → 종합 점수
 */
export async function verifyStructuralFidelity(
  generatedImageBase64: string,
  lineartBase64: string,
  options?: VerificationOptions,
): Promise<VerificationResult> {
  const threshold = options?.threshold ?? 0.4;
  const sensitivity = options?.edgeSensitivity ?? 30;
  const resolution = options?.compareResolution ?? 512;
  const dilationRadius = options?.dilationRadius ?? 3;

  const startTime = Date.now();

  // Step 1: 라인아트에서 에지 추출
  const refEdges = await extractLineartEdges(lineartBase64, resolution);

  // Step 2: 생성 이미지에서 에지 추출
  const genEdges = await extractEdges(generatedImageBase64, resolution, sensitivity);

  // Step 3: 라인아트 에지 팽창 (정렬 오차 허용)
  const refDilated = dilateEdges(refEdges.edges, refEdges.width, refEdges.height, dilationRadius);

  // Step 4: IoU 계산
  let intersection = 0;
  let union = 0;
  let refCount = 0;
  let genCount = 0;

  const totalPixels = refEdges.edges.length;
  for (let i = 0; i < totalPixels; i++) {
    const refActive = refDilated[i] > 0;
    const genActive = genEdges.edges[i] > 0;

    if (refEdges.edges[i] > 0) refCount++;
    if (genActive) genCount++;

    if (refActive && genActive) intersection++;
    if (refActive || genActive) union++;
  }

  const edgeIoU = union > 0 ? intersection / union : 0;

  // Step 5: SSIM 근사
  const ssimApprox = computeSSIMApprox(refDilated, genEdges.edges);

  // 종합 점수: IoU 60% + SSIM 40%
  const score = edgeIoU * 0.6 + Math.max(0, ssimApprox) * 0.4;
  const passed = score >= threshold;

  const elapsed = Date.now() - startTime;

  const result: VerificationResult = {
    score: Math.round(score * 1000) / 1000,
    edgeIoU: Math.round(edgeIoU * 1000) / 1000,
    ssimApprox: Math.round(ssimApprox * 1000) / 1000,
    referenceEdgePixels: refCount,
    generatedEdgePixels: genCount,
    overlappingEdgePixels: intersection,
    passed,
    message: passed
      ? `구조 일치 통과 (${(score * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(1)}%)`
      : `구조 일치 미달 (${(score * 100).toFixed(1)}% < ${(threshold * 100).toFixed(1)}%). ControlNet strength 증가 권장.`,
  };

  log.info({
    score: result.score,
    edgeIoU: result.edgeIoU,
    ssimApprox: result.ssimApprox,
    passed,
    refEdges: refCount,
    genEdges: genCount,
    overlap: intersection,
    elapsed,
  }, 'Structural verification completed');

  return result;
}

/**
 * 에지 맵을 PNG 이미지로 변환 (디버그/시각화용)
 */
export async function edgeMapToPng(
  imageBase64: string,
  isLineart: boolean,
  resolution: number = 512,
  sensitivity: number = 30,
): Promise<string> {
  const { edges, width, height } = isLineart
    ? await extractLineartEdges(imageBase64, resolution)
    : await extractEdges(imageBase64, resolution, sensitivity);

  const pngBuffer = await sharp(Buffer.from(edges), {
    raw: { width, height, channels: 1 },
  })
    .png()
    .toBuffer();

  return pngBuffer.toString('base64');
}

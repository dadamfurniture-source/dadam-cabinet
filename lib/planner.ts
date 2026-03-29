export type CabinetCategory = 'sink' | 'wardrobe' | 'vanity' | 'shoe' | 'fridge' | 'storage';

export type MaterialTone = 'cream' | 'oak' | 'walnut' | 'graphite';

export type ModuleSection = 'lower' | 'upper' | 'full';

export type ModuleKind = 'door' | 'drawer' | 'open';

export interface CabinetModule {
  id: string;
  section: ModuleSection;
  kind: ModuleKind;
  width: number;
  height: number;
  depth: number;
}

export interface CabinetPreset {
  id: CabinetCategory;
  name: string;
  summary: string;
  roomLabel: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultDepth: number;
  lowerHeight: number;
  upperHeight: number;
  upperDepth: number;
  toeKickHeight: number;
  counterThickness: number;
  lowerCount: number;
  upperCount: number;
  hasCountertop: boolean;
  fullHeight: boolean;
  defaultMoldingH: number;
}

export interface PlannerState {
  presetId: CabinetCategory;
  width: number;
  height: number;
  depth: number;
  lowerCount: number;
  upperCount: number;
  material: MaterialTone;
  moldingH: number;
  toeKickH: number;
  finishLeftW: number;
  finishRightW: number;
}

export interface CabinetPart {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  colorKey: 'body' | 'accent' | 'shadow' | 'trim';
  wireframe?: boolean;
}

export interface DerivedCabinet {
  preset: CabinetPreset;
  parts: CabinetPart[];
  modules: CabinetModule[];
  footprintAreaM2: number;
  facadeAreaM2: number;
  estimatedBoardAreaM2: number;
}

export const MATERIALS: Record<
  MaterialTone,
  { name: string; body: string; accent: string; shadow: string; trim: string }
> = {
  cream: { name: 'Warm Cream', body: '#f1ede3', accent: '#d4c4a8', shadow: '#b7aa90', trim: '#c8bda8' },
  oak: { name: 'Natural Oak', body: '#d1b089', accent: '#9e7144', shadow: '#6f5031', trim: '#8a6a42' },
  walnut: { name: 'Deep Walnut', body: '#8b6447', accent: '#b48a6a', shadow: '#5d412c', trim: '#6e5238' },
  graphite: { name: 'Graphite', body: '#696a6b', accent: '#c2b49c', shadow: '#3d4042', trim: '#555657' },
};

export const PRESETS: CabinetPreset[] = [
  {
    id: 'sink',
    name: '싱크대',
    summary: '하부장, 상부장, 상판을 한 번에 조정하는 주방형 레이아웃',
    roomLabel: '주방',
    defaultWidth: 3000,
    defaultHeight: 2300,
    defaultDepth: 600,
    lowerHeight: 870,
    upperHeight: 720,
    upperDepth: 295,
    toeKickHeight: 150,
    counterThickness: 12,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: true,
    fullHeight: false,
    defaultMoldingH: 60,
  },
  {
    id: 'wardrobe',
    name: '붙박이장',
    summary: '천장까지 차오르는 침실 수납장과 행거 중심 구성',
    roomLabel: '침실',
    defaultWidth: 3600,
    defaultHeight: 2400,
    defaultDepth: 620,
    lowerHeight: 2400,
    upperHeight: 0,
    upperDepth: 0,
    toeKickHeight: 40,
    counterThickness: 0,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: false,
    fullHeight: true,
    defaultMoldingH: 20,
  },
  {
    id: 'vanity',
    name: '화장대',
    summary: '거울 하부 서랍장과 측면 수납을 포함한 파우더존 구성',
    roomLabel: '침실',
    defaultWidth: 1400,
    defaultHeight: 2000,
    defaultDepth: 550,
    lowerHeight: 780,
    upperHeight: 1050,
    upperDepth: 220,
    toeKickHeight: 80,
    counterThickness: 18,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: true,
    fullHeight: false,
    defaultMoldingH: 40,
  },
  {
    id: 'shoe',
    name: '신발장',
    summary: '현관형 얕은 깊이와 오픈 니치가 어울리는 수납 레이아웃',
    roomLabel: '현관',
    defaultWidth: 1800,
    defaultHeight: 2300,
    defaultDepth: 360,
    lowerHeight: 2300,
    upperHeight: 0,
    upperDepth: 0,
    toeKickHeight: 70,
    counterThickness: 0,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: false,
    fullHeight: true,
    defaultMoldingH: 30,
  },
  {
    id: 'fridge',
    name: '냉장고장',
    summary: '냉장고 니치와 키큰장 조합에 맞춘 주방 수납 시스템',
    roomLabel: '주방',
    defaultWidth: 1900,
    defaultHeight: 2350,
    defaultDepth: 700,
    lowerHeight: 2350,
    upperHeight: 0,
    upperDepth: 0,
    toeKickHeight: 80,
    counterThickness: 0,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: false,
    fullHeight: true,
    defaultMoldingH: 50,
  },
  {
    id: 'storage',
    name: '수납장',
    summary: '거실, 다용도실, 팬트리에 대응하는 범용 수납장',
    roomLabel: '멀티룸',
    defaultWidth: 2400,
    defaultHeight: 2200,
    defaultDepth: 500,
    lowerHeight: 2200,
    upperHeight: 0,
    upperDepth: 0,
    toeKickHeight: 60,
    counterThickness: 0,
    lowerCount: 0,
    upperCount: 0,
    hasCountertop: false,
    fullHeight: true,
    defaultMoldingH: 40,
  },
];

export const getPresetById = (id: CabinetCategory): CabinetPreset =>
  PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const distributeWidths = (totalWidth: number, count: number) => {
  const safeCount = Math.max(1, count);
  const raw = totalWidth / safeCount;
  const rounded = Math.round(raw / 50) * 50;
  const widths = Array.from({ length: safeCount }, () => rounded);
  const used = rounded * safeCount;
  widths[widths.length - 1] += totalWidth - used;
  return widths;
};

export const createPlannerState = (presetId: CabinetCategory): PlannerState => {
  const preset = getPresetById(presetId);
  return {
    presetId,
    width: preset.defaultWidth,
    height: preset.defaultHeight,
    depth: preset.defaultDepth,
    lowerCount: preset.lowerCount,
    upperCount: preset.upperCount,
    material: 'cream',
    moldingH: preset.defaultMoldingH,
    toeKickH: preset.toeKickHeight,
    finishLeftW: 60,
    finishRightW: 60,
  };
};

const buildModules = (
  section: ModuleSection,
  count: number,
  width: number,
  height: number,
  depth: number,
  kind: ModuleKind
): CabinetModule[] =>
  distributeWidths(width, count).map((moduleWidth, index) => ({
    id: `${section}-${index + 1}`,
    section,
    kind,
    width: moduleWidth,
    height,
    depth,
  }));

export const deriveCabinet = (state: PlannerState): DerivedCabinet => {
  const preset = getPresetById(state.presetId);
  const width = clamp(Math.round(state.width), 600, 6000);
  const height = clamp(Math.round(state.height), 700, 2800);
  const depth = clamp(Math.round(state.depth), 220, 900);
  const lowerCount = clamp(Math.round(state.lowerCount), 0, 10);
  const upperCount = clamp(Math.round(state.upperCount), 0, 10);
  const moldingH = clamp(Math.round(state.moldingH ?? 0), 0, 120);
  const toeKickH = clamp(Math.round(state.toeKickH ?? 0), 0, 300);
  const finishLeftW = clamp(Math.round(state.finishLeftW ?? 0), 0, 200);
  const finishRightW = clamp(Math.round(state.finishRightW ?? 0), 0, 200);

  const effectiveWidth = Math.max(0, width - finishLeftW - finishRightW);
  const counterThickness = preset.hasCountertop ? preset.counterThickness : 0;
  const upperDepth = preset.fullHeight ? depth : preset.upperDepth;

  // --- 실측 기준 Y 좌표 계산 (바닥 Y=0) ---
  // 하부장: 걸레받이 위에 배치
  const lowerBodyH = preset.fullHeight
    ? Math.max(0, height - moldingH - toeKickH)
    : Math.min(preset.lowerHeight - toeKickH, height - toeKickH);
  const lowerBottomY = toeKickH;
  const lowerTopY = lowerBottomY + lowerBodyH;

  // 상부장: 천장 몰딩 아래에 배치
  const upperHeight = preset.fullHeight ? 0 : Math.min(preset.upperHeight, Math.max(0, height - moldingH - lowerTopY - counterThickness));
  const upperTopY = height - moldingH;
  const upperBottomY = upperTopY - upperHeight;

  // 상부장 Z offset: 벽 쪽으로 후퇴 (하부장보다 얕음)
  const upperZOffset = preset.fullHeight ? 0 : -(depth - upperDepth) / 2;

  const parts: CabinetPart[] = [];

  // --- 모듈 생성 ---
  const modules: CabinetModule[] = lowerCount > 0
    ? buildModules('lower', lowerCount, effectiveWidth, lowerBodyH, depth, preset.fullHeight ? 'door' : 'drawer')
    : [];

  if (upperHeight > 0 && upperCount > 0) {
    modules.push(...buildModules('upper', upperCount, effectiveWidth, upperHeight, upperDepth, 'door'));
  }

  // 모듈 X offset: 좌측 마감재 이후부터 시작
  const moduleStartX = -width / 2 + finishLeftW;
  let cursor = moduleStartX;

  modules.forEach((module) => {
    const centeredX = cursor + module.width / 2;
    const isUpper = module.section === 'upper';
    const y = isUpper
      ? upperBottomY + module.height / 2
      : lowerBottomY + module.height / 2;
    const z = isUpper ? upperZOffset : 0;

    parts.push({
      id: module.id,
      label: `${module.section}-${module.kind}`,
      x: centeredX,
      y,
      z,
      width: module.width,
      height: module.height,
      depth: module.depth,
      colorKey: isUpper ? 'accent' : 'body',
    });

    if (module.kind !== 'open') {
      parts.push({
        id: `${module.id}-face`,
        label: `${module.id}-face`,
        x: centeredX,
        y,
        z: z + module.depth / 2 + 6,
        width: Math.max(18, module.width - 8),
        height: Math.max(18, module.height - 8),
        depth: 12,
        colorKey: 'shadow',
      });
    }

    cursor += module.width;
  });

  const hasFinish = finishLeftW > 0 || finishRightW > 0 || moldingH > 0 || toeKickH > 0;

  // --- 마감재 (실측 완료 시 모듈 없어도 표시) ---

  // 상몰딩 — 상부장 기준 (폭: 유효폭 + 좌우마감, 깊이: upperDepth, Z: 상부장과 동일)
  if (moldingH > 0) {
    const moldingDepth = preset.fullHeight ? depth : upperDepth;
    const moldingZ = preset.fullHeight ? 0 : upperZOffset;
    parts.push({
      id: 'molding-top',
      label: '상몰딩',
      x: 0,
      y: height - moldingH / 2,
      z: moldingZ,
      width,
      height: moldingH,
      depth: moldingDepth + 6,
      colorKey: 'trim',
    });
  }

  // 걸레받이 — 바닥 위, 유효폭
  if (toeKickH > 0) {
    parts.push({
      id: 'toekick',
      label: '걸레받이',
      x: 0,
      y: toeKickH / 2,
      z: -20,
      width: effectiveWidth,
      height: toeKickH,
      depth: depth - 40,
      colorKey: 'trim',
    });
  }

  // 좌/우 마감재 — 하부장/상부장 별도 (실측 기준 Y 정렬)
  const finishSides: Array<{ id: string; label: string; x: number; fw: number }> = [];
  if (finishLeftW > 0) finishSides.push({ id: 'left', label: '좌', x: -width / 2 + finishLeftW / 2, fw: finishLeftW });
  if (finishRightW > 0) finishSides.push({ id: 'right', label: '우', x: width / 2 - finishRightW / 2, fw: finishRightW });

  for (const side of finishSides) {
    if (preset.fullHeight) {
      const finishH = height - toeKickH - moldingH;
      parts.push({
        id: `finish-${side.id}`,
        label: `마감재(${side.label})`,
        x: side.x,
        y: toeKickH + finishH / 2,
        z: 0,
        width: side.fw,
        height: finishH,
        depth,
        colorKey: 'trim',
      });
    } else {
      // 하부장 마감재 — 모듈 높이 + 걸레받이 포함
      const lowerFinishH = lowerBodyH + toeKickH;
      parts.push({
        id: `finish-${side.id}-lower`,
        label: `마감재(${side.label})-하부`,
        x: side.x,
        y: lowerFinishH / 2,
        z: 0,
        width: side.fw,
        height: lowerFinishH,
        depth,
        colorKey: 'trim',
      });
      // 상부장 마감재 — 모듈 높이 + 상몰딩 포함
      if (upperHeight > 0) {
        const upperFinishH = upperHeight + moldingH;
        parts.push({
          id: `finish-${side.id}-upper`,
          label: `마감재(${side.label})-상부`,
          x: side.x,
          y: height - upperFinishH / 2,
          z: upperZOffset,
          width: side.fw,
          height: upperFinishH,
          depth: upperDepth,
          colorKey: 'trim',
        });
      }
    }
  }

  // --- 설치공간 wireframe (모듈 없을 때) ---
  if (lowerCount === 0 && hasFinish) {
    if (preset.fullHeight) {
      const spaceH = height - toeKickH - moldingH;
      parts.push({
        id: 'install-space',
        label: '설치공간',
        x: 0,
        y: toeKickH + spaceH / 2,
        z: 0,
        width: effectiveWidth,
        height: spaceH,
        depth,
        colorKey: 'accent',
        wireframe: true,
      });
    } else {
      // 하부장 설치공간
      parts.push({
        id: 'install-space-lower',
        label: '설치공간(하부)',
        x: 0,
        y: lowerBottomY + lowerBodyH / 2,
        z: 0,
        width: effectiveWidth,
        height: lowerBodyH,
        depth,
        colorKey: 'accent',
        wireframe: true,
      });
      // 상부장 설치공간
      if (upperHeight > 0) {
        parts.push({
          id: 'install-space-upper',
          label: '설치공간(상부)',
          x: 0,
          y: upperBottomY + upperHeight / 2,
          z: upperZOffset,
          width: effectiveWidth,
          height: upperHeight,
          depth: upperDepth,
          colorKey: 'accent',
          wireframe: true,
        });
      }
    }
  }

  // Countertop — 하부장 상단에 배치
  if (preset.hasCountertop && lowerCount > 0) {
    parts.push({
      id: 'countertop',
      label: 'countertop',
      x: 0,
      y: lowerTopY + counterThickness / 2,
      z: 0,
      width,
      height: counterThickness,
      depth: depth + 18,
      colorKey: 'shadow',
    });
  }

  if (preset.id === 'fridge' && lowerCount > 0) {
    parts.push({
      id: 'fridge-cavity',
      label: 'fridge-cavity',
      x: -width * 0.18,
      y: height * 0.42,
      z: 0,
      width: width * 0.34,
      height: height * 0.78,
      depth: depth - 60,
      colorKey: 'accent',
      wireframe: true,
    });
  }

  if (preset.id === 'vanity' && lowerCount > 0) {
    parts.push({
      id: 'mirror',
      label: 'mirror',
      x: 0,
      y: lowerTopY + upperHeight * 0.45,
      z: depth / 2 + 20,
      width: width * 0.7,
      height: Math.max(600, upperHeight * 0.8),
      depth: 8,
      colorKey: 'accent',
    });
  }

  const footprintAreaM2 = Number(((width * depth) / 1_000_000).toFixed(2));
  const facadeAreaM2 = Number(((width * height) / 1_000_000).toFixed(2));
  const estimatedBoardAreaM2 = Number(
    (((width * height * 2 + width * depth * 2 + height * depth * 2) / 1_000_000) * 1.15).toFixed(2)
  );

  return {
    preset,
    parts,
    modules,
    footprintAreaM2,
    facadeAreaM2,
    estimatedBoardAreaM2,
  };
};

export const formatMillimeters = (value: number) => `${Math.round(value).toLocaleString('ko-KR')} mm`;

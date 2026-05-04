'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { CabinetCategory, MaterialTone } from '../../lib/planner';

const EmbedCanvas = dynamic(() => import('../../components/planner/EmbedCanvas'), {
  ssr: false,
});

const VALID_PRESETS: CabinetCategory[] = ['sink', 'wardrobe', 'vanity', 'shoe', 'fridge', 'storage'];
const VALID_MATERIALS: MaterialTone[] = ['cream', 'oak', 'walnut', 'graphite'];

function EmbedWithParams() {
  const searchParams = useSearchParams();

  const preset = searchParams.get('preset') as CabinetCategory | null;
  const w = Number(searchParams.get('w')) || undefined;
  const h = Number(searchParams.get('h')) || undefined;
  const d = Number(searchParams.get('d')) || undefined;
  const material = searchParams.get('material') as MaterialTone | null;
  const lc = Number(searchParams.get('lowerCount')) || undefined;
  const uc = Number(searchParams.get('upperCount')) || undefined;
  const view = (searchParams.get('view') || 'perspective') as 'perspective' | 'front' | 'top';
  const moldingH = Number(searchParams.get('moldingH')) || undefined;
  const toeKickH = Number(searchParams.get('toeKickH')) || undefined;
  const finishLeftW = Number(searchParams.get('finishLeftW')) ?? undefined;
  const finishRightW = Number(searchParams.get('finishRightW')) ?? undefined;

  return (
    <EmbedCanvas
      initialPreset={preset && VALID_PRESETS.includes(preset) ? preset : 'sink'}
      initialWidth={w}
      initialHeight={h}
      initialDepth={d}
      initialMaterial={material && VALID_MATERIALS.includes(material) ? material : undefined}
      initialLowerCount={lc}
      initialUpperCount={uc}
      initialView={view}
      initialMoldingH={moldingH}
      initialToeKickH={toeKickH}
      initialFinishLeftW={finishLeftW}
      initialFinishRightW={finishRightW}
    />
  );
}

export default function EmbedPage() {
  return (
    <Suspense fallback={null}>
      <EmbedWithParams />
    </Suspense>
  );
}

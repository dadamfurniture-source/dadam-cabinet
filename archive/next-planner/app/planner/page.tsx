'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { DadamPlannerProps } from '../../components/planner/DadamPlanner';
import type { CabinetCategory, MaterialTone } from '../../lib/planner';

const DadamPlanner = dynamic(() => import('../../components/planner/DadamPlanner'), {
  ssr: false,
});

const VALID_PRESETS: CabinetCategory[] = ['sink', 'wardrobe', 'vanity', 'shoe', 'fridge', 'storage'];
const VALID_MATERIALS: MaterialTone[] = ['cream', 'oak', 'walnut', 'graphite'];

function PlannerWithParams() {
  const searchParams = useSearchParams();

  const props: DadamPlannerProps = {};

  const preset = searchParams.get('preset');
  if (preset && VALID_PRESETS.includes(preset as CabinetCategory)) {
    props.initialPreset = preset as CabinetCategory;
  }

  const w = searchParams.get('w');
  if (w) props.initialWidth = Number(w);

  const h = searchParams.get('h');
  if (h) props.initialHeight = Number(h);

  const d = searchParams.get('d');
  if (d) props.initialDepth = Number(d);

  const material = searchParams.get('material');
  if (material && VALID_MATERIALS.includes(material as MaterialTone)) {
    props.initialMaterial = material as MaterialTone;
  }

  const lc = searchParams.get('lowerCount');
  if (lc) props.initialLowerCount = Number(lc);

  const uc = searchParams.get('upperCount');
  if (uc) props.initialUpperCount = Number(uc);

  return <DadamPlanner {...props} />;
}

export default function PlannerPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-dadam-gray">Loading...</div>}>
      <PlannerWithParams />
    </Suspense>
  );
}

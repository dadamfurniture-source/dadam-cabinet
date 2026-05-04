import Link from 'next/link';
import { PRESETS } from '../lib/planner';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#f5ede0_0%,#f8f7f4_45%,#ece4d8_100%)] text-dadam-charcoal">
      <section className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-20 md:px-12 lg:flex-row lg:items-end lg:justify-between lg:py-28">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.35em] text-[#9a7c56]">DADAM DIGITAL WORKBENCH</p>
          <h1 className="mt-4 font-serif text-5xl leading-tight md:text-7xl">
            다담가구 전용
            <br />
            3D 도면 프로그램
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-dadam-gray">
            기존 다담 설계 데이터의 카테고리 구조를 바탕으로, 실측 전환이 쉬운 웹형 3D 편집기를 만들었습니다.
            싱크대부터 붙박이장까지 치수와 모듈을 바꾸면 즉시 형상이 갱신됩니다.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/planner" className="btn-primary">
              3D 편집기 열기
            </Link>
            <Link href="/portfolio" className="btn-outline">
              기존 포트폴리오 보기
            </Link>
          </div>
        </div>

        <div className="grid w-full max-w-xl gap-4 rounded-[32px] border border-[#dacdbb] bg-white/80 p-5 shadow-[0_24px_80px_rgba(67,47,21,0.08)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.25em] text-[#9a7c56]">Supported Cabinet Types</p>
          <div className="grid grid-cols-2 gap-3">
            {PRESETS.map((preset) => (
              <div key={preset.id} className="rounded-2xl bg-[#f7f1e8] p-4">
                <p className="text-base font-semibold">{preset.name}</p>
                <p className="mt-2 text-sm text-dadam-gray">{preset.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

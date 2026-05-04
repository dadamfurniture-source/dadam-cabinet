'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function BillingCancelInner() {
  const params = useSearchParams();
  const code = params.get('code');
  const message = params.get('message');

  return (
    <main className="min-h-screen bg-dadam-cream px-6 py-20">
      <div className="mx-auto max-w-xl rounded-2xl border border-dadam-warm bg-white p-10 text-center shadow-sm">
        <h1 className="mb-4 text-3xl font-semibold text-dadam-charcoal">결제가 취소되었습니다</h1>
        <p className="mb-8 text-dadam-gray">
          {message || '카드 인증이 완료되지 않아 구독이 시작되지 않았습니다.'}
        </p>
        {code && <p className="mb-6 text-xs text-dadam-gray">오류 코드: {code}</p>}
        <div className="flex flex-col gap-3">
          <a
            href="/pricing"
            className="rounded-lg bg-dadam-charcoal px-6 py-3 text-white transition hover:bg-black"
          >
            다시 시도하기
          </a>
          <a href="/" className="text-sm text-dadam-gray underline-offset-2 hover:underline">
            홈으로 돌아가기
          </a>
        </div>
      </div>
    </main>
  );
}

export default function BillingCancelPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-dadam-cream" />}>
      <BillingCancelInner />
    </Suspense>
  );
}

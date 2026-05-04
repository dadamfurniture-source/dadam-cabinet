'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Sparkles } from 'lucide-react';
import { auth } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const { data, error } = await auth.signIn(email, password);

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setError('이메일 또는 비밀번호가 올바르지 않습니다.');
        } else {
          setError(error.message);
        }
        return;
      }

      if (data.user) {
        router.push('/');
      }
    } catch (err) {
      setError('로그인 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = async (provider: 'google' | 'kakao') => {
    setIsLoading(true);
    setError('');

    try {
      if (provider === 'google') {
        await auth.signInWithGoogle();
      } else {
        await auth.signInWithKakao();
      }
    } catch (err) {
      setError('소셜 로그인 중 오류가 발생했습니다.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dadam-cream flex">
      {/* Left: Brand Section */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-dadam-charcoal">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-dadam-gold rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-dadam-gold rounded-full blur-3xl" />
          </div>
        </div>

        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <Link href="/" className="flex items-center gap-3 mb-12">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor">
              <path d="M20 4L4 12v16l16 8 16-8V12L20 4zm0 4l12 6-12 6-12-6 12-6zm-12 10l12 6 12-6v8l-12 6-12-6v-8z" />
            </svg>
            <span className="font-serif text-3xl">다담</span>
          </Link>

          <h1 className="font-serif text-4xl leading-tight mb-6">
            AI가 설계하는
            <br />
            <span className="text-dadam-gold">프리미엄</span> 맞춤 가구
          </h1>

          <p className="text-white/60 text-lg mb-12 max-w-md">
            30년 장인정신과 AI 기술의 만남.
            <br />
            완벽한 공간을 위한 최선의 선택.
          </p>

          <div className="flex items-center gap-4 text-sm text-white/40">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-dadam-gold" />
              <span>AI 설계 시스템</span>
            </div>
            <span>•</span>
            <span>30년 경력 장인</span>
            <span>•</span>
            <span>평생 A/S</span>
          </div>
        </div>
      </div>

      {/* Right: Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <Link href="/" className="flex items-center gap-2 mb-8 lg:hidden">
            <svg
              width="32"
              height="32"
              viewBox="0 0 40 40"
              fill="currentColor"
              className="text-dadam-charcoal"
            >
              <path d="M20 4L4 12v16l16 8 16-8V12L20 4zm0 4l12 6-12 6-12-6 12-6zm-12 10l12 6 12-6v8l-12 6-12-6v-8z" />
            </svg>
            <span className="font-serif text-2xl text-dadam-charcoal">다담</span>
          </Link>

          <div className="mb-8">
            <h2 className="font-serif text-3xl text-dadam-charcoal mb-2">로그인</h2>
            <p className="text-dadam-gray">
              계정이 없으신가요?{' '}
              <Link href="/signup" className="text-dadam-gold hover:underline">
                회원가입
              </Link>
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Input */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-dadam-charcoal mb-2">
                이메일
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dadam-gray" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  required
                  className="w-full pl-12 pr-4 py-4 bg-white border border-dadam-warm rounded-xl
                           text-dadam-charcoal placeholder:text-dadam-gray/50
                           focus:outline-none focus:border-dadam-gold focus:ring-2 focus:ring-dadam-gold/20
                           transition-all"
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-dadam-charcoal mb-2"
              >
                비밀번호
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dadam-gray" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  required
                  className="w-full pl-12 pr-12 py-4 bg-white border border-dadam-warm rounded-xl
                           text-dadam-charcoal placeholder:text-dadam-gray/50
                           focus:outline-none focus:border-dadam-gold focus:ring-2 focus:ring-dadam-gold/20
                           transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-dadam-gray hover:text-dadam-charcoal transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Remember & Forgot */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-dadam-warm text-dadam-gold focus:ring-dadam-gold/20"
                />
                <span className="text-sm text-dadam-gray">로그인 유지</span>
              </label>
              <Link href="/forgot-password" className="text-sm text-dadam-gold hover:underline">
                비밀번호 찾기
              </Link>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 bg-dadam-charcoal text-white rounded-xl font-medium
                       hover:bg-dadam-gold transition-colors flex items-center justify-center gap-2
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="animate-pulse">로그인 중...</span>
              ) : (
                <>
                  로그인
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="my-8 flex items-center gap-4">
            <div className="flex-1 h-px bg-dadam-warm" />
            <span className="text-sm text-dadam-gray">또는</span>
            <div className="flex-1 h-px bg-dadam-warm" />
          </div>

          {/* Social Login */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => handleSocialLogin('google')}
              disabled={isLoading}
              className="w-full py-4 bg-white border border-dadam-warm rounded-xl font-medium
                       text-dadam-charcoal hover:bg-dadam-cream transition-colors
                       flex items-center justify-center gap-3
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google로 계속하기
            </button>

            <button
              type="button"
              onClick={() => handleSocialLogin('kakao')}
              disabled={isLoading}
              className="w-full py-4 bg-[#FEE500] rounded-xl font-medium
                       text-[#191919] hover:bg-[#FDD800] transition-colors
                       flex items-center justify-center gap-3
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#191919">
                <path d="M12 3C6.48 3 2 6.58 2 11c0 2.85 1.93 5.35 4.84 6.75-.22.81-.8 2.93-.92 3.38-.14.54.2.53.42.39.17-.11 2.72-1.84 3.83-2.59.59.09 1.2.13 1.83.13 5.52 0 10-3.58 10-8s-4.48-8-10-8z" />
              </svg>
              카카오로 계속하기
            </button>
          </div>

          {/* Footer */}
          <p className="mt-8 text-center text-sm text-dadam-gray">
            로그인하면{' '}
            <Link href="/terms" className="text-dadam-gold hover:underline">
              이용약관
            </Link>{' '}
            및{' '}
            <Link href="/privacy" className="text-dadam-gold hover:underline">
              개인정보처리방침
            </Link>
            에 동의하게 됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}

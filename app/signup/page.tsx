'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Mail, Lock, User, ArrowRight, Check } from 'lucide-react';
import { auth } from '@/lib/supabase';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);

  // 비밀번호 유효성 검사
  const passwordChecks = {
    length: password.length >= 8,
    hasNumber: /\d/.test(password),
    hasLetter: /[a-zA-Z]/.test(password),
    match: password === confirmPassword && password.length > 0,
  };

  const isPasswordValid =
    passwordChecks.length && passwordChecks.hasNumber && passwordChecks.hasLetter;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!agreeTerms) {
      setError('필수 약관에 동의해주세요.');
      return;
    }

    if (!isPasswordValid) {
      setError('비밀번호 조건을 확인해주세요.');
      return;
    }

    if (!passwordChecks.match) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await auth.signUp(email, password, name);

      if (error) {
        if (error.message.includes('already registered')) {
          setError('이미 가입된 이메일입니다.');
        } else {
          setError(error.message);
        }
        return;
      }

      // 이메일 인증 필요 여부에 따라 분기
      if (data.user && !data.user.confirmed_at) {
        router.push('/signup/verify?email=' + encodeURIComponent(email));
      } else {
        router.push('/');
      }
    } catch (err) {
      setError('회원가입 중 오류가 발생했습니다. 다시 시도해주세요.');
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
            다담가구 회원이 되어
            <br />
            <span className="text-dadam-gold">특별한 혜택</span>을 누리세요
          </h1>

          <ul className="space-y-4 text-white/80">
            <li className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-dadam-gold/20 flex items-center justify-center">
                <Check className="w-4 h-4 text-dadam-gold" />
              </div>
              <span>AI 맞춤 설계 무료 상담</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-dadam-gold/20 flex items-center justify-center">
                <Check className="w-4 h-4 text-dadam-gold" />
              </div>
              <span>회원 전용 특별 할인</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-dadam-gold/20 flex items-center justify-center">
                <Check className="w-4 h-4 text-dadam-gold" />
              </div>
              <span>시공 진행 상황 실시간 확인</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-dadam-gold/20 flex items-center justify-center">
                <Check className="w-4 h-4 text-dadam-gold" />
              </div>
              <span>평생 A/S 보장 및 이력 관리</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Right: Signup Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 overflow-y-auto">
        <div className="w-full max-w-md py-8">
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
            <h2 className="font-serif text-3xl text-dadam-charcoal mb-2">회원가입</h2>
            <p className="text-dadam-gray">
              이미 계정이 있으신가요?{' '}
              <Link href="/login" className="text-dadam-gold hover:underline">
                로그인
              </Link>
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Social Signup */}
          <div className="space-y-3 mb-8">
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
              Google로 가입하기
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
              카카오로 가입하기
            </button>
          </div>

          {/* Divider */}
          <div className="my-8 flex items-center gap-4">
            <div className="flex-1 h-px bg-dadam-warm" />
            <span className="text-sm text-dadam-gray">또는 이메일로 가입</span>
            <div className="flex-1 h-px bg-dadam-warm" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name Input */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-dadam-charcoal mb-2">
                이름
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dadam-gray" />
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="홍길동"
                  required
                  className="w-full pl-12 pr-4 py-4 bg-white border border-dadam-warm rounded-xl
                           text-dadam-charcoal placeholder:text-dadam-gray/50
                           focus:outline-none focus:border-dadam-gold focus:ring-2 focus:ring-dadam-gold/20
                           transition-all"
                />
              </div>
            </div>

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

              {/* Password Requirements */}
              {password && (
                <div className="mt-3 space-y-2">
                  <div
                    className={`flex items-center gap-2 text-sm ${passwordChecks.length ? 'text-green-600' : 'text-dadam-gray'}`}
                  >
                    <Check className="w-4 h-4" />
                    <span>8자 이상</span>
                  </div>
                  <div
                    className={`flex items-center gap-2 text-sm ${passwordChecks.hasLetter ? 'text-green-600' : 'text-dadam-gray'}`}
                  >
                    <Check className="w-4 h-4" />
                    <span>영문 포함</span>
                  </div>
                  <div
                    className={`flex items-center gap-2 text-sm ${passwordChecks.hasNumber ? 'text-green-600' : 'text-dadam-gray'}`}
                  >
                    <Check className="w-4 h-4" />
                    <span>숫자 포함</span>
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-dadam-charcoal mb-2"
              >
                비밀번호 확인
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dadam-gray" />
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="비밀번호를 다시 입력하세요"
                  required
                  className={`w-full pl-12 pr-4 py-4 bg-white border rounded-xl
                           text-dadam-charcoal placeholder:text-dadam-gray/50
                           focus:outline-none focus:ring-2 transition-all
                           ${
                             confirmPassword && !passwordChecks.match
                               ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
                               : 'border-dadam-warm focus:border-dadam-gold focus:ring-dadam-gold/20'
                           }`}
                />
              </div>
              {confirmPassword && !passwordChecks.match && (
                <p className="mt-2 text-sm text-red-500">비밀번호가 일치하지 않습니다.</p>
              )}
            </div>

            {/* Terms Agreement */}
            <div className="space-y-3 pt-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="w-5 h-5 mt-0.5 rounded border-dadam-warm text-dadam-gold focus:ring-dadam-gold/20"
                />
                <span className="text-sm text-dadam-charcoal">
                  <span className="text-red-500">[필수]</span>{' '}
                  <Link href="/terms" className="text-dadam-gold hover:underline">
                    이용약관
                  </Link>{' '}
                  및{' '}
                  <Link href="/privacy" className="text-dadam-gold hover:underline">
                    개인정보처리방침
                  </Link>
                  에 동의합니다.
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreeMarketing}
                  onChange={(e) => setAgreeMarketing(e.target.checked)}
                  className="w-5 h-5 mt-0.5 rounded border-dadam-warm text-dadam-gold focus:ring-dadam-gold/20"
                />
                <span className="text-sm text-dadam-gray">
                  [선택] 마케팅 정보 수신에 동의합니다.
                </span>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || !agreeTerms}
              className="w-full py-4 bg-dadam-charcoal text-white rounded-xl font-medium
                       hover:bg-dadam-gold transition-colors flex items-center justify-center gap-2
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="animate-pulse">가입 처리 중...</span>
              ) : (
                <>
                  회원가입
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

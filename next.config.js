/** @type {import('next').NextConfig} */
const nextConfig = {
  // 정적 내보내기 모드 (Vercel/Netlify 등 정적 호스팅용)
  // 동적 기능이 필요하면 이 줄을 주석 처리하세요
  output: 'export',
  trailingSlash: true,

  images: {
    unoptimized: true,
    // 정적 내보내기 시 이미지 최적화는 외부 서비스 사용 권장
    // Cloudflare Images, imgix, Cloudinary 등
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },

  // 성능 최적화
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // X-Powered-By 헤더 제거 (보안)
  poweredByHeader: false,

  // 보안 헤더 설정
  async headers() {
    return [
      {
        // 모든 경로에 적용
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

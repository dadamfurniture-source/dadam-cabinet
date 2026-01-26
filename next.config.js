/** @type {import('next').NextConfig} */
const nextConfig = {
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
  // 번들 분석 (개발 시)
  // webpack: (config, { isServer }) => {
  //   if (!isServer) {
  //     config.resolve.fallback = { fs: false };
  //   }
  //   return config;
  // },
};

module.exports = nextConfig;

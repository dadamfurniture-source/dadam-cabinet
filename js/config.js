window.DADAM_CONFIG = {
  supabase: {
    url: 'https://vvqrvgcgnlfpiqqndsve.supabase.co',
    anonKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2cXJ2Z2NnbmxmcGlxcW5kc3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4NTYyMjYsImV4cCI6MjA4MzQzMjIyNn0.WvMdB2bojqRUjYWdljAcxP1yHqQZJwuyv2equltyWWQ',
  },
  multiagent: {
    apiUrl: '', // 비활성 → Codex generate API 사용
  },
  generateApi: {
    // Cloudflare Worker (workers/generate-api/). main 푸시 시 자동 배포.
    // 품목별 프롬프트 · Claude Opus pre-analysis 등 최신 생성 로직이 전부 이쪽에 있음.
    url: 'https://dadam-generate-api.dadamfurniture.workers.dev/api/generate',
  },
  app: {
    name: '다담가구',
    version: '1.0.0',
  },
};

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
    // Cloudflare Workers — workers/generate-api (wrangler deploy 로 배포)
    url: 'https://dadam-generate-api.dadamfurniture.workers.dev/api/generate',
  },
  app: {
    name: '다담가구',
    version: '1.0.0',
  },
};

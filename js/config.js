window.DADAM_CONFIG = {
  supabase: {
    url: 'https://vvqrvgcgnlfpiqqndsve.supabase.co',
    anonKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2cXJ2Z2NnbmxmcGlxcW5kc3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4NTYyMjYsImV4cCI6MjA4MzQzMjIyNn0.WvMdB2bojqRUjYWdljAcxP1yHqQZJwuyv2equltyWWQ',
  },
  multiagent: {
    apiUrl: '', // 비활성 → Codex generate API 사용
  },
  workflowApi: {
    // Cloudflare Worker (workers/workflow-api/). main 푸시 시 자동 배포.
    // 스냅샷 · 견적 · 고객확인서/작업지시서 · 일정/Slack.
    url: 'https://dadam-workflow-api.dadamfurniture.workers.dev',
  },
  generateApi: {
    // Cloudflare Worker (workers/generate-api/). main 푸시 시 자동 배포.
    // 품목별 프롬프트 · Claude Opus pre-analysis 등 최신 생성 로직이 전부 이쪽에 있음.
    url: 'https://dadam-generate-api.dadamfurniture.workers.dev/api/generate',
  },
  accountApi: {
    // Cloudflare Worker (workers/account-api/). main 푸시 시 자동 배포.
    // 회원탈퇴 — auth.users 삭제는 service_role 이 필요해 브라우저에서 못 한다.
    url: 'https://dadam-account-api.dadamfurniture.workers.dev',
  },
  app: {
    name: '다담가구',
    version: '1.0.0',
  },
};

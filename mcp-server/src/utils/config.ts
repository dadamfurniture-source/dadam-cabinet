// ═══════════════════════════════════════════════════════════════
// Configuration - 환경 변수 로드 및 설정
// ═══════════════════════════════════════════════════════════════

export interface Config {
  supabase: {
    url: string;
    anonKey: string;
    timeout: number;
  };
  gemini: {
    apiKey: string;
    timeout: number;
    models: {
      vision: string;
      imageGeneration: string;
      imagePreview: string;
    };
  };
  server: {
    port: number;
    host: string;
  };
  logLevel: string;
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue || '';
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultValue;
  return parsed;
}

export function loadConfig(): Config {
  return {
    supabase: {
      url: getEnv('SUPABASE_URL', 'https://vvqrvgcgnlfpiqqndsve.supabase.co'),
      anonKey: getEnv('SUPABASE_ANON_KEY', ''),
      timeout: getEnvNumber('SUPABASE_TIMEOUT', 30000),
    },
    gemini: {
      apiKey: getEnv('GEMINI_API_KEY', ''),
      timeout: getEnvNumber('GEMINI_TIMEOUT', 120000),
      models: {
        vision: 'gemini-2.0-flash',
        imageGeneration: 'gemini-2.0-flash-exp-image',
        imagePreview: 'gemini-3-pro-image-preview',
      },
    },
    server: {
      port: getEnvNumber('MCP_SERVER_PORT', 3100),
      host: getEnv('MCP_SERVER_HOST', 'localhost'),
    },
    logLevel: getEnv('LOG_LEVEL', 'info'),
  };
}

// 싱글톤 config 인스턴스
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

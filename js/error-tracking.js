/**
 * Error Tracking - Sentry 연동 및 에러 핸들링
 * 클라이언트 에러 수집 및 모니터링
 */

(function () {
  'use strict';

  // Sentry 설정 (실제 DSN으로 교체 필요)
  const SENTRY_CONFIG = {
    dsn: window.SENTRY_DSN || '', // 환경 변수에서 로드
    environment: window.APP_ENV || 'development',
    release: window.APP_VERSION || '1.0.0',
    sampleRate: 1.0, // 100% 샘플링 (프로덕션에서는 조정)
    tracesSampleRate: 0.1, // 10% 트레이스 샘플링
  };

  /**
   * ErrorTracker 클래스
   * Sentry 및 커스텀 에러 추적
   */
  class ErrorTracker {
    constructor(config = {}) {
      this.config = { ...SENTRY_CONFIG, ...config };
      this.initialized = false;
      this.errorQueue = []; // Sentry 초기화 전 에러 큐
      this.userContext = null;
    }

    /**
     * Sentry 초기화
     */
    async init() {
      if (this.initialized) return;

      // Sentry SDK 로드 확인
      if (typeof Sentry !== 'undefined' && this.config.dsn) {
        try {
          Sentry.init({
            dsn: this.config.dsn,
            environment: this.config.environment,
            release: this.config.release,
            sampleRate: this.config.sampleRate,
            tracesSampleRate: this.config.tracesSampleRate,
            integrations: [
              new Sentry.BrowserTracing({
                tracingOrigins: ['localhost', 'dadamfurniture.com', /^\//],
              }),
              new Sentry.Replay({
                maskAllText: true,
                blockAllMedia: true,
              }),
            ],
            // 에러 필터링
            beforeSend(event, hint) {
              const error = hint.originalException;

              // 무시할 에러 패턴
              const ignorePatterns = [
                /ResizeObserver loop/,
                /Script error/,
                /ChunkLoadError/,
                /Loading chunk/,
                /Network request failed/,
              ];

              if (error && error.message) {
                for (const pattern of ignorePatterns) {
                  if (pattern.test(error.message)) {
                    return null;
                  }
                }
              }

              return event;
            },
            // 브레드크럼 필터링
            beforeBreadcrumb(breadcrumb) {
              // 민감한 URL 필터링
              if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
                if (breadcrumb.data?.url?.includes('password')) {
                  breadcrumb.data.url = '[FILTERED]';
                }
              }
              return breadcrumb;
            },
          });

          this.initialized = true;
          console.log('Sentry initialized');

          // 큐에 있던 에러 전송
          this.flushQueue();
        } catch (e) {
          console.error('Sentry initialization failed:', e);
        }
      } else {
        // Sentry 없이 콘솔 로깅만 사용
        console.log('Sentry not available, using console logging only');
        this.initialized = true;
        this.flushQueue();
      }

      // 전역 에러 핸들러 설정
      this.setupGlobalHandlers();
    }

    /**
     * 전역 에러 핸들러 설정
     */
    setupGlobalHandlers() {
      // 처리되지 않은 에러
      window.onerror = (message, source, lineno, colno, error) => {
        this.captureError(error || new Error(message), {
          source,
          lineno,
          colno,
          type: 'unhandled',
        });
        return false;
      };

      // Promise rejection
      window.onunhandledrejection = (event) => {
        this.captureError(event.reason, {
          type: 'unhandledRejection',
        });
      };
    }

    /**
     * 사용자 컨텍스트 설정
     * @param {Object} user - 사용자 정보
     */
    setUser(user) {
      this.userContext = user;

      if (typeof Sentry !== 'undefined' && this.initialized) {
        Sentry.setUser({
          id: user.id,
          email: user.email,
          tier: user.tier,
        });
      }
    }

    /**
     * 사용자 컨텍스트 초기화
     */
    clearUser() {
      this.userContext = null;

      if (typeof Sentry !== 'undefined' && this.initialized) {
        Sentry.setUser(null);
      }
    }

    /**
     * 태그 설정
     * @param {string} key - 태그 키
     * @param {string} value - 태그 값
     */
    setTag(key, value) {
      if (typeof Sentry !== 'undefined' && this.initialized) {
        Sentry.setTag(key, value);
      }
    }

    /**
     * 에러 캡처
     * @param {Error} error - 에러 객체
     * @param {Object} context - 추가 컨텍스트
     */
    captureError(error, context = {}) {
      const errorData = {
        error,
        context,
        timestamp: new Date().toISOString(),
        userContext: this.userContext,
        url: window.location.href,
        userAgent: navigator.userAgent,
      };

      if (!this.initialized) {
        this.errorQueue.push(errorData);
        return;
      }

      // 콘솔 로깅
      console.error('Error captured:', error, context);

      // Sentry 전송
      if (typeof Sentry !== 'undefined') {
        Sentry.withScope((scope) => {
          scope.setExtras(context);
          scope.setTag('error_type', context.type || 'unknown');

          if (context.component) {
            scope.setTag('component', context.component);
          }

          Sentry.captureException(error);
        });
      }

      // 커스텀 에러 리포팅 (선택적)
      this.sendToCustomEndpoint(errorData);
    }

    /**
     * 메시지 캡처
     * @param {string} message - 메시지
     * @param {string} level - 레벨 (info, warning, error)
     * @param {Object} context - 추가 컨텍스트
     */
    captureMessage(message, level = 'info', context = {}) {
      console.log(`[${level.toUpperCase()}] ${message}`, context);

      if (typeof Sentry !== 'undefined' && this.initialized) {
        Sentry.withScope((scope) => {
          scope.setExtras(context);
          Sentry.captureMessage(message, level);
        });
      }
    }

    /**
     * 브레드크럼 추가
     * @param {Object} breadcrumb - 브레드크럼 데이터
     */
    addBreadcrumb(breadcrumb) {
      if (typeof Sentry !== 'undefined' && this.initialized) {
        Sentry.addBreadcrumb(breadcrumb);
      }
    }

    /**
     * 큐 플러시
     */
    flushQueue() {
      while (this.errorQueue.length > 0) {
        const errorData = this.errorQueue.shift();
        this.captureError(errorData.error, errorData.context);
      }
    }

    /**
     * 커스텀 엔드포인트로 전송 (선택적)
     * @param {Object} errorData - 에러 데이터
     */
    async sendToCustomEndpoint(errorData) {
      const endpoint = window.ERROR_REPORTING_ENDPOINT;
      if (!endpoint) return;

      try {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...errorData,
            error: {
              name: errorData.error?.name,
              message: errorData.error?.message,
              stack: errorData.error?.stack,
            },
          }),
        });
      } catch (e) {
        // 에러 리포팅 실패는 무시
      }
    }

    /**
     * 트랜잭션 시작 (성능 모니터링)
     * @param {string} name - 트랜잭션 이름
     * @param {string} op - 작업 타입
     * @returns {Object} 트랜잭션 객체
     */
    startTransaction(name, op = 'custom') {
      if (typeof Sentry !== 'undefined' && this.initialized) {
        return Sentry.startTransaction({ name, op });
      }
      return {
        finish: () => {},
        setStatus: () => {},
        startChild: () => ({ finish: () => {} }),
      };
    }
  }

  /**
   * React Error Boundary 래퍼 (선택적)
   */
  function withErrorBoundary(Component, fallback = null) {
    return class ErrorBoundary extends (window.React?.Component || class {}) {
      constructor(props) {
        super(props);
        this.state = { hasError: false };
      }

      static getDerivedStateFromError() {
        return { hasError: true };
      }

      componentDidCatch(error, errorInfo) {
        window.DadamErrorTracker?.captureError(error, {
          type: 'react_error_boundary',
          componentStack: errorInfo.componentStack,
        });
      }

      render() {
        if (this.state.hasError) {
          return fallback || null;
        }
        return this.props.children;
      }
    };
  }

  /**
   * 에러 핸들링 유틸리티
   */
  const ErrorUtils = {
    /**
     * 비동기 함수 래핑
     */
    wrapAsync(fn, context = {}) {
      return async (...args) => {
        try {
          return await fn(...args);
        } catch (error) {
          window.DadamErrorTracker?.captureError(error, {
            type: 'async_error',
            ...context,
          });
          throw error;
        }
      };
    },

    /**
     * 이벤트 핸들러 래핑
     */
    wrapHandler(handler, context = {}) {
      return (event) => {
        try {
          return handler(event);
        } catch (error) {
          window.DadamErrorTracker?.captureError(error, {
            type: 'event_handler_error',
            ...context,
          });
        }
      };
    },

    /**
     * API 호출 래핑
     */
    async safeApiCall(apiCall, fallback = null) {
      try {
        return await apiCall();
      } catch (error) {
        window.DadamErrorTracker?.captureError(error, {
          type: 'api_error',
        });
        return fallback;
      }
    },
  };

  // 싱글톤 인스턴스 생성
  const errorTracker = new ErrorTracker();

  // DOM 준비 후 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => errorTracker.init());
  } else {
    errorTracker.init();
  }

  // 전역 노출
  window.DadamErrorTracker = errorTracker;
  window.DadamErrorUtils = ErrorUtils;
  window.withErrorBoundary = withErrorBoundary;
})();

/**
 * Image Optimization - 이미지 최적화 유틸리티
 * Lazy Loading, WebP 지원, 반응형 이미지
 */

(function () {
  'use strict';

  /**
   * IntersectionObserver 기반 Lazy Loading
   */
  class LazyLoader {
    constructor(options = {}) {
      this.options = {
        root: null,
        rootMargin: '50px 0px',
        threshold: 0.01,
        ...options,
      };

      this.observer = null;
      this.init();
    }

    init() {
      if ('IntersectionObserver' in window) {
        this.observer = new IntersectionObserver(this.onIntersection.bind(this), this.options);
        this.observe();
      } else {
        // Fallback: 모든 이미지 즉시 로드
        this.loadAllImages();
      }
    }

    observe() {
      const lazyImages = document.querySelectorAll('[data-src], [data-srcset]');
      lazyImages.forEach((img) => this.observer.observe(img));
    }

    onIntersection(entries) {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          this.loadImage(entry.target);
          this.observer.unobserve(entry.target);
        }
      });
    }

    loadImage(element) {
      const src = element.dataset.src;
      const srcset = element.dataset.srcset;

      if (element.tagName === 'IMG') {
        if (srcset) element.srcset = srcset;
        if (src) element.src = src;
      } else {
        // background-image 처리
        if (src) element.style.backgroundImage = `url(${src})`;
      }

      element.classList.remove('lazy');
      element.classList.add('lazy-loaded');

      // 로드 완료 이벤트
      element.dispatchEvent(new CustomEvent('lazyloaded'));
    }

    loadAllImages() {
      const lazyImages = document.querySelectorAll('[data-src], [data-srcset]');
      lazyImages.forEach((img) => this.loadImage(img));
    }

    // 새로 추가된 이미지 관찰
    refresh() {
      if (this.observer) {
        this.observe();
      }
    }

    destroy() {
      if (this.observer) {
        this.observer.disconnect();
      }
    }
  }

  /**
   * WebP 지원 확인
   * @returns {Promise<boolean>}
   */
  function supportsWebP() {
    return new Promise((resolve) => {
      const webP = new Image();
      webP.onload = webP.onerror = () => {
        resolve(webP.height === 2);
      };
      webP.src =
        'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
    });
  }

  /**
   * 이미지 소스 선택 (WebP 우선)
   * @param {string} originalSrc - 원본 이미지 경로
   * @param {boolean} webPSupported - WebP 지원 여부
   * @returns {string} 최적 이미지 경로
   */
  function getOptimalSource(originalSrc, webPSupported) {
    if (!webPSupported) return originalSrc;

    // .jpg, .jpeg, .png → .webp 변환
    const ext = originalSrc.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png'].includes(ext)) {
      const webPSrc = originalSrc.replace(/\.(jpg|jpeg|png)$/i, '.webp');
      return webPSrc;
    }
    return originalSrc;
  }

  /**
   * 반응형 이미지 srcset 생성
   * @param {string} src - 기본 이미지 경로
   * @param {Array} sizes - 크기 배열 [320, 640, 1024, 1920]
   * @returns {string} srcset 문자열
   */
  function generateSrcset(src, sizes = [320, 640, 1024, 1920]) {
    const ext = src.split('.').pop();
    const baseName = src.replace(`.${ext}`, '');

    return sizes.map((size) => `${baseName}-${size}w.${ext} ${size}w`).join(', ');
  }

  /**
   * 이미지 프리로드
   * @param {string} src - 이미지 경로
   * @returns {Promise}
   */
  function preloadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * 중요 이미지 프리로드 (LCP 최적화)
   * @param {Array} sources - 이미지 경로 배열
   */
  function preloadCriticalImages(sources) {
    sources.forEach((src) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = src;
      document.head.appendChild(link);
    });
  }

  /**
   * 이미지 최적화 초기화
   */
  async function initImageOptimization() {
    // WebP 지원 확인
    const webPSupported = await supportsWebP();
    document.documentElement.classList.add(webPSupported ? 'webp' : 'no-webp');

    // Lazy Loader 초기화
    const lazyLoader = new LazyLoader();

    // 전역 노출
    window.DadamImages = {
      lazyLoader,
      webPSupported,
      supportsWebP,
      getOptimalSource,
      generateSrcset,
      preloadImage,
      preloadCriticalImages,
      refresh: () => lazyLoader.refresh(),
    };
  }

  // DOM 준비 후 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initImageOptimization);
  } else {
    initImageOptimization();
  }
})();

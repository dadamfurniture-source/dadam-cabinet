import { translations } from './translations.js';

export class I18n {
  constructor() {
    this.lang = localStorage.getItem('dadam-lang') || 'ko';
    this.init();
  }

  init() {
    this.applyLanguage(this.lang);
    this.bindEvents();
  }

  toggleLanguage() {
    this.lang = this.lang === 'ko' ? 'en' : 'ko';
    localStorage.setItem('dadam-lang', this.lang);
    this.applyLanguage(this.lang);
  }

  applyLanguage(lang) {
    document.documentElement.lang = lang;
    const data = translations[lang];

    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n');
      const value = this.getNestedValue(data, key);

      if (value) {
        if (element.tagName === 'INPUT' && element.getAttribute('placeholder')) {
          element.placeholder = value;
        } else {
          // XSS 방지: innerHTML 대신 textContent 사용
          element.textContent = value;
        }
      }
    });

    // Update Toggle Button Text
    const toggleBtn = document.getElementById('lang-toggle');
    if (toggleBtn) {
      // XSS 방지: DOM API 사용
      const textSpan = toggleBtn.querySelector('span') || document.createElement('span');
      textSpan.textContent = lang.toUpperCase();
      if (!toggleBtn.contains(textSpan)) {
        toggleBtn.insertBefore(textSpan, toggleBtn.firstChild);
      }
    }
  }

  getNestedValue(obj, key) {
    return key.split('.').reduce((o, i) => (o ? o[i] : null), obj);
  }

  bindEvents() {
    const toggleBtn = document.getElementById('lang-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleLanguage());
    }
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  window.i18nInstance = new I18n();
});

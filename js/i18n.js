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

        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const value = this.getNestedValue(data, key);

            if (value) {
                if (element.tagName === 'INPUT' && element.getAttribute('placeholder')) {
                    element.placeholder = value;
                } else {
                    element.innerHTML = value;
                }
            }
        });

        // Update Toggle Button Text
        const toggleBtn = document.getElementById('lang-toggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = `
                ${lang.toUpperCase()} 
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <use href="#icon-chevron-down" />
                </svg>
            `;
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

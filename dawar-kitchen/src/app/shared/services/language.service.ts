import { Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, RTL_LANGUAGE, STORAGE_KEYS } from '../constants';
import { StorageUtil, DomUtil } from '../utils';

/**
 * Language service for managing EN/AR bilingual support
 * - Manages language switching
 * - Persists language preference to localStorage
 * - Handles RTL support for Arabic
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private currentLanguage$ = new BehaviorSubject<string>(
    this.getInitialLanguage()
  );

  /** True while a language-switch fade transition is in progress. */
  readonly transitioning = signal(false);

  private switchTimer?: ReturnType<typeof setTimeout>;

  constructor(private translateService: TranslateService) {
    // Initialization is deferred to initialize() which is called by
    // APP_INITIALIZER — this blocks app startup until translations are
    // loaded, so components never render with raw keys on first paint.
  }

  /**
   * Get initial language from localStorage or use default
   */
  private getInitialLanguage(): string {
    const stored = StorageUtil.get(STORAGE_KEYS.LANGUAGE);
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
      return stored;
    }
    return DEFAULT_LANGUAGE;
  }

  /**
   * Bootstrap-time initialization. Called by APP_INITIALIZER so translations
   * are loaded and cached BEFORE any component renders — preventing raw keys
   * from flashing on first paint.
   */
  async initialize(): Promise<void> {
    this.translateService.addLangs([...SUPPORTED_LANGUAGES]);
    const lang = this.getInitialLanguage();
    this.applyDocumentLanguage(lang);
    StorageUtil.set(STORAGE_KEYS.LANGUAGE, lang);

    const cached = this.translateService.translations[lang];
    if (cached && Object.keys(cached).length === 0) {
      this.translateService.resetLang(lang);
    }

    try {
      await firstValueFrom(this.translateService.use(lang));
      this.currentLanguage$.next(lang);
      // Promote DEFAULT_LANGUAGE as the fallback default once it's cached
      // (setDefaultLang finds it in the cache — no new HTTP, no race).
      if (lang === DEFAULT_LANGUAGE &&
          this.translateService.defaultLang !== DEFAULT_LANGUAGE) {
        this.translateService.setDefaultLang(DEFAULT_LANGUAGE);
      }
    } catch {
      // If the initial language fails to load, fall back to DEFAULT_LANGUAGE
      if (lang === DEFAULT_LANGUAGE) {
        this.currentLanguage$.next(lang);
        return;
      }
      this.applyDocumentLanguage(DEFAULT_LANGUAGE);
      StorageUtil.set(STORAGE_KEYS.LANGUAGE, DEFAULT_LANGUAGE);
      this.translateService.resetLang(DEFAULT_LANGUAGE);
      try {
        await firstValueFrom(this.translateService.use(DEFAULT_LANGUAGE));
      } catch {
        // Last resort — app starts with empty translations
      }
      this.currentLanguage$.next(DEFAULT_LANGUAGE);
    }
  }

  /**
   * Set active language
   * - Updates TranslateService
   * - Persists to localStorage
   * - Sets document lang and RTL attributes
   *
   * @param animate  when true, coordinates a brief fade transition so the text
   *                 and direction swap is masked visually (default: true).
   */
  setLanguage(lang: string, animate = true): void {
    if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
      return;
    }

    clearTimeout(this.switchTimer);

    if (animate) {
      // Start the fade-out; swap language at minimum opacity (≈120 ms in).
      this.transitioning.set(true);
      this.switchTimer = setTimeout(() => this.doLanguageSwitch(lang), 120);
    } else {
      this.doLanguageSwitch(lang);
    }
  }

  /**
   * Perform the actual language swap — direction, storage, and translation load.
   * Only hits the network when translations are not yet cached (or cached empty),
   * so subsequent toggles are instant.
   */
  private doLanguageSwitch(lang: string): void {
    this.applyDocumentLanguage(lang);
    StorageUtil.set(STORAGE_KEYS.LANGUAGE, lang);

    // If translations were previously cached as an empty object (e.g. a load
    // that failed during early bootstrap), clear the cache so use() re-fetches.
    // We use resetLang() — NOT reloadLang() — because reloadLang() calls
    // getTranslation() without storing the request, so the subsequent use() →
    // retrieveTranslations() starts a SECOND concurrent getTranslation() that
    // races on ngx-translate's shared this.loadingTranslations field and
    // corrupts the cache. resetLang() only clears; use() then triggers exactly
    // one clean fetch via retrieveTranslations → getTranslation.
    const cached = this.translateService.translations[lang];
    if (cached && Object.keys(cached).length === 0) {
      this.translateService.resetLang(lang);
    }

    this.translateService.use(lang).subscribe({
      next: () => {
        this.currentLanguage$.next(lang);
        // Once DEFAULT_LANGUAGE is loaded and cached, promote it to the
        // fallback default. setDefaultLang() finds it in the cache, so it
        // calls changeDefaultLang() directly — no new HTTP, no pending state,
        // no race. This ensures missing keys fall back to English.
        if (lang === DEFAULT_LANGUAGE && this.translateService.defaultLang !== DEFAULT_LANGUAGE) {
          this.translateService.setDefaultLang(DEFAULT_LANGUAGE);
        }
        // Hold the fade until the CSS animation finishes (≈280 ms total).
        setTimeout(() => this.transitioning.set(false), 160);
      },
      error: () => this.handleLanguageFallback(lang)
    });
  }

  /**
   * Fall back to the default language when the requested language fails to load.
   */
  private handleLanguageFallback(lang: string): void {
    if (lang === DEFAULT_LANGUAGE) {
      this.currentLanguage$.next(DEFAULT_LANGUAGE);
      this.transitioning.set(false);
      return;
    }

    this.applyDocumentLanguage(DEFAULT_LANGUAGE);
    StorageUtil.set(STORAGE_KEYS.LANGUAGE, DEFAULT_LANGUAGE);
    this.translateService.resetLang(DEFAULT_LANGUAGE);
    this.translateService.use(DEFAULT_LANGUAGE).subscribe({
      next: () => {
        this.currentLanguage$.next(DEFAULT_LANGUAGE);
        this.transitioning.set(false);
      },
      error: () => {
        this.currentLanguage$.next(DEFAULT_LANGUAGE);
        this.transitioning.set(false);
      }
    });
  }

  private applyDocumentLanguage(lang: string): void {
    const doc = DomUtil.getDocument();
    if (!doc) return;

    const isRtl = lang === RTL_LANGUAGE;
    doc.documentElement.lang = lang;
    doc.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    doc.documentElement.classList.toggle('rtl', isRtl);
    doc.documentElement.classList.toggle('ltr', !isRtl);
    doc.body.classList.toggle('rtl', isRtl);
    doc.body.classList.toggle('ltr', !isRtl);
  }

  /**
   * Get current language as Observable
   */
  getCurrentLanguage(): Observable<string> {
    return this.currentLanguage$.asObservable();
  }

  /**
   * Get current language value synchronously
   */
  getCurrentLanguageValue(): string {
    return this.currentLanguage$.value;
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages(): string[] {
    return [...SUPPORTED_LANGUAGES];
  }

  /**
   * Toggle between EN and AR
   */
  toggleLanguage(): void {
    const newLang =
      this.currentLanguage$.value === 'en' ? 'ar' : 'en';
    this.setLanguage(newLang);
  }

  /**
   * Get the "other" language (opposite of current)
   */
  getOtherLanguage(): string {
    return this.currentLanguage$.value === 'en' ? 'ar' : 'en';
  }
}

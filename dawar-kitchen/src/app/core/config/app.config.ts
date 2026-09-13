import { ApplicationConfig, isDevMode, importProvidersFrom, APP_INITIALIZER } from '@angular/core';
import { provideRouter, withInMemoryScrolling, withPreloading, PreloadAllModules } from '@angular/router';
import { environment } from '../../../environments/environment';
import { provideHttpClient, withFetch, withInterceptors, HttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideServiceWorker } from '@angular/service-worker';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { routes } from './app.routes';
import { authInterceptor, errorInterceptor, languageInterceptor } from '../interceptors';
import { LanguageService } from '../../shared/services';

/**
 * APP_INITIALIZER factory — blocks app startup until translations are loaded
 * so components never render with raw translation keys on first paint.
 */
function initializeI18n(languageService: LanguageService): () => Promise<void> {
  return () => languageService.initialize();
}

export class MultiTranslateHttpLoader implements TranslateLoader {
  private readonly files = ['common', 'home', 'menu', 'reservations', 'auth', 'contact', 'payment'];

  constructor(private readonly http: HttpClient, private readonly prefix = '/assets/i18n/') {}

  public getTranslation(lang: string): Observable<any> {
    const requests = this.files.map(file =>
      this.http.get(`${this.prefix}${lang}/${file}.json`, {
        params: { v: environment.i18nVersion }
      }).pipe(catchError(() => of({})))
    );

    return forkJoin(requests).pipe(
      map(responses => Object.assign({}, ...responses))
    );
  }
}

export function HttpLoaderFactory(http: HttpClient) {
  return new MultiTranslateHttpLoader(http, '/assets/i18n/');
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideAnimations(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        scrollPositionRestoration: 'top',
        anchorScrolling: 'enabled'
      }),
      withPreloading(PreloadAllModules)
    ),
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor, languageInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    }),
    // ✅ TranslateModule for i18n (standalone configuration)
    // NOTE: defaultLanguage is intentionally NOT set here. Setting it triggers an
    // early setDefaultLang() → getTranslation() during TranslateService construction
    // (the earliest bootstrap moment), which races the dev-server asset compilation
    // and can cache an empty {} for 'en' that ngx-translate never retries. The
    // LanguageService owns all language loading instead.
    importProvidersFrom(
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useFactory: HttpLoaderFactory,
          deps: [HttpClient]
        }
      })
    ),
    // ✅ Block app startup until translations are loaded — prevents raw keys
    // from flashing on first paint.
    {
      provide: APP_INITIALIZER,
      useFactory: initializeI18n,
      deps: [LanguageService],
      multi: true
    }
  ]
};

import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SIN_SERVIDOR } from '../plataforma';
import { LocalService } from './local.service';

/** En Android ninguna petición de documentos llega al transporte HTTP. */
export const localInterceptor: HttpInterceptorFn = (req, next) => {
  if (!SIN_SERVIDOR || !req.url.startsWith('/api/')) return next(req);
  const local = inject(LocalService);
  return new Observable(subscriber => {
    const controller = new AbortController();
    local.atender(req, controller.signal).then(body => {
      subscriber.next(new HttpResponse({ body, status: 200, url: req.url }));
      subscriber.complete();
    }, error => subscriber.error(error instanceof HttpErrorResponse ? error : new HttpErrorResponse({
      status: 422, url: req.url, error: { error: error instanceof Error ? error.message : 'No se ha podido completar la operación.' },
    })));
    return () => controller.abort();
  });
};

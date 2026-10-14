import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/**
 * Absolute links into the web app, for emails and messages. Everything lives on the main domain:
 * a school at /<slug>/…, the platform console at /console/… (a school's own paid domain serves the
 * same pages at its root, but links always use the main domain, which works for every school).
 */
@Injectable()
export class WebUrls {
  private readonly origin: string;

  constructor(config: ConfigService<Env, true>) {
    const port = config.get('WEB_URL_PORT', { infer: true });
    this.origin = `${config.get('WEB_URL_SCHEME', { infer: true })}://${config.get('BASE_DOMAIN', { infer: true })}${port ? `:${port}` : ''}`;
  }

  /** https://ed-tech.example.com/demo/<path> */
  school(slug: string, path = '/'): string {
    return `${this.origin}/${slug}${path === '/' ? '' : path}`;
  }

  /** The platform console: https://ed-tech.example.com/console/<path> */
  platform(path = '/'): string {
    return `${this.origin}/console${path === '/' ? '' : path}`;
  }

  /** The public site. */
  site(path = '/'): string {
    return `${this.origin}${path}`;
  }
}

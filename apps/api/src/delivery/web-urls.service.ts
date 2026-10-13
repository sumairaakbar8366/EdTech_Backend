import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/** Absolute links into the web app, for emails and messages. */
@Injectable()
export class WebUrls {
  private readonly scheme: string;
  private readonly port: string;
  private readonly baseDomain: string;
  private readonly platformHost: string;

  constructor(config: ConfigService<Env, true>) {
    this.scheme = config.get('WEB_URL_SCHEME', { infer: true });
    const port = config.get('WEB_URL_PORT', { infer: true });
    this.port = port ? `:${port}` : '';
    this.baseDomain = config.get('BASE_DOMAIN', { infer: true });
    this.platformHost = config.get('PLATFORM_HOST', { infer: true });
  }

  /** https://demo.schoolerp.pk/<path> */
  school(slug: string, path = '/'): string {
    return `${this.scheme}://${slug}.${this.baseDomain}${this.port}${path}`;
  }

  /** The platform console. */
  platform(path = '/'): string {
    return `${this.scheme}://${this.platformHost}${this.port}${path}`;
  }

  /** The public marketing site. */
  site(path = '/'): string {
    return `${this.scheme}://${this.baseDomain}${this.port}${path}`;
  }
}

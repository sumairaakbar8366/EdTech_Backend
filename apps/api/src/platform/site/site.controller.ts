import { Body, Controller, Get, Header, Put } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { PlatformOnly, Public } from '../../auth/decorators.js';
import { socialLinks, SocialLinksDto } from '../../common/social-links.js';
import { WebUrls } from '../../delivery/web-urls.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class SiteSettingsDto extends SocialLinksDto {
  @IsOptional() @Transform(trimOrNull) @IsEmail() @MaxLength(254) contactEmail?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(300) address?: string | null;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function siteSettings(prisma: PrismaService) {
  const r = await prisma.platformSiteSettings.findUnique({ where: { id: 1 } });
  return { contactEmail: r?.contactEmail ?? null, phone: r?.phone ?? null, address: r?.address ?? null, ...socialLinks(r) };
}

/** The public site's contact details and social accounts, and the sitemap search engines read. */
@Public()
@Controller('public')
export class PublicSiteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: WebUrls,
  ) {}

  @Get('site-settings')
  settings() {
    return siteSettings(this.prisma);
  }

  /** The home page and every school's public website that is online. Served at /sitemap.xml. */
  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async sitemap() {
    const schools = await this.prisma.school.findMany({ where: { status: 'active' }, select: { id: true, slug: true, updatedAt: true }, orderBy: { createdAt: 'asc' } });
    const online = await Promise.all(
      schools.map(async (s) => {
        const w = await this.prisma.forSchool(s.id).schoolWebsite.findUnique({ where: { schoolId: s.id }, select: { published: true, updatedAt: true } });
        return w?.published === false ? null : { loc: this.urls.school(s.slug), lastmod: (w?.updatedAt ?? s.updatedAt).toISOString().slice(0, 10) };
      }),
    );
    const entries = [{ loc: this.urls.site('/'), lastmod: null as string | null }, ...online.filter((e): e is { loc: string; lastmod: string } => !!e)];
    const body = entries.map((e) => `  <url><loc>${xml(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  }
}

/** Owner console: the public site's contact details and social accounts. */
@PlatformOnly()
@Controller('platform/site-settings')
export class PlatformSiteController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  get() {
    return siteSettings(this.prisma);
  }

  @Put()
  async save(@Body() dto: SiteSettingsDto) {
    await this.prisma.platformSiteSettings.upsert({ where: { id: 1 }, create: { id: 1, ...dto }, update: dto });
    return siteSettings(this.prisma);
  }
}

import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
/** "0300 1234567" / "+92 300-1234567" → "+923001234567" (local numbers read as Pakistani). */
const toE164 = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  let v = value.replace(/[\s()-]/g, '');
  if (!v) return null;
  if (/^0\d{10}$/.test(v)) v = `+92${v.slice(1)}`;
  else if (/^00\d+$/.test(v)) v = `+${v.slice(2)}`;
  return v;
};
const profile = (hosts: string) => new RegExp(`^https://([a-z0-9-]+\\.)*(${hosts})(/\\S*)?$`, 'i');

/**
 * Social accounts a school (website settings) or the platform owner (console) adds themselves.
 * Links must be https and on that network, so a typo cannot send visitors elsewhere.
 */
export class SocialLinksDto {
  @IsOptional() @Transform(toE164) @IsString() @Matches(/^\+[1-9]\d{7,14}$/, { message: 'WhatsApp number must be like +923001234567' }) whatsapp?: string | null;
  @IsOptional() @Transform(trimOrNull) @MaxLength(300) @Matches(profile('facebook\\.com|fb\\.com'), { message: 'Facebook link must be an https://facebook.com/… page' }) facebookUrl?: string | null;
  @IsOptional() @Transform(trimOrNull) @MaxLength(300) @Matches(profile('instagram\\.com'), { message: 'Instagram link must be an https://instagram.com/… profile' }) instagramUrl?: string | null;
  @IsOptional() @Transform(trimOrNull) @MaxLength(300) @Matches(profile('youtube\\.com|youtu\\.be'), { message: 'YouTube link must be an https://youtube.com/… channel' }) youtubeUrl?: string | null;
  @IsOptional() @Transform(trimOrNull) @MaxLength(300) @Matches(profile('linkedin\\.com'), { message: 'LinkedIn link must be an https://linkedin.com/… page' }) linkedinUrl?: string | null;
  @IsOptional() @Transform(trimOrNull) @MaxLength(300) @Matches(profile('tiktok\\.com'), { message: 'TikTok link must be an https://tiktok.com/@… profile' }) tiktokUrl?: string | null;
  @IsOptional() @Transform(trimOrNull) @MaxLength(300) @Matches(profile('x\\.com|twitter\\.com'), { message: 'X link must be an https://x.com/… profile' }) xUrl?: string | null;
}

export type SocialLinks = { whatsapp: string | null; facebookUrl: string | null; instagramUrl: string | null; youtubeUrl: string | null; linkedinUrl: string | null; tiktokUrl: string | null; xUrl: string | null };

export const socialLinks = (r: Partial<SocialLinks> | null | undefined): SocialLinks => ({
  whatsapp: r?.whatsapp ?? null,
  facebookUrl: r?.facebookUrl ?? null,
  instagramUrl: r?.instagramUrl ?? null,
  youtubeUrl: r?.youtubeUrl ?? null,
  linkedinUrl: r?.linkedinUrl ?? null,
  tiktokUrl: r?.tiktokUrl ?? null,
  xUrl: r?.xUrl ?? null,
});

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { detectAllowedType, safeFileName } from '../documents/file-type.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { PostDto } from './sponsorship.dto.js';

/** Platform files live under this fixed folder (storage keys are "<folder>/<id>"). */
const PLATFORM_FOLDER = '00000000-0000-4000-8000-000000000001';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES_PER_POST = 12;
const IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;

/** The owner's posts on the public site: awards, scholarships, events and news, with photos. */
@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private data(dto: PostDto, by?: string) {
    return {
      kind: dto.kind, title: dto.title, body: dto.body, eventName: dto.eventName ?? null, eventDate: dto.eventDate ? new Date(`${dto.eventDate}T00:00:00Z`) : null,
      location: dto.location ?? null, schoolName: dto.schoolName ?? null, published: dto.published ?? true, ...(by && { createdBy: by }),
    };
  }

  list() {
    return this.prisma.sitePost.findMany({ orderBy: { publishedAt: 'desc' }, take: 200, include: { images: { orderBy: { sortOrder: 'asc' }, select: { id: true, caption: true, fileName: true } } } });
  }

  create(dto: PostDto, by: string) {
    return this.prisma.sitePost.create({ data: this.data(dto, by), include: { images: true } });
  }

  async update(id: string, dto: PostDto) {
    await this.exists(id);
    return this.prisma.sitePost.update({ where: { id }, data: this.data(dto), include: { images: { orderBy: { sortOrder: 'asc' } } } });
  }

  async remove(id: string) {
    const post = await this.prisma.sitePost.findUnique({ where: { id }, include: { images: { select: { storageKey: true } } } });
    if (!post) throw new NotFoundException('Post not found');
    await this.prisma.sitePost.delete({ where: { id } });
    await Promise.all(post.images.map((i) => this.storage.delete(i.storageKey)));
  }

  async addImage(postId: string, file: Express.Multer.File, caption?: string) {
    await this.exists(postId);
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Photos can be at most 8 MB.');
    const mimeType = detectAllowedType(file.originalname, file.buffer, IMAGE_TYPES);
    if (!mimeType) throw new BadRequestException('Only JPG and PNG photos are allowed.');
    if ((await this.prisma.sitePostImage.count({ where: { postId } })) >= MAX_IMAGES_PER_POST) throw new BadRequestException(`A post can have at most ${MAX_IMAGES_PER_POST} photos.`);
    const storageKey = `${PLATFORM_FOLDER}/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer);
    const last = await this.prisma.sitePostImage.aggregate({ where: { postId }, _max: { sortOrder: true } });
    return this.prisma.sitePostImage.create({ data: { postId, fileName: safeFileName(file.originalname), mimeType, sizeBytes: file.size, storageKey, caption: caption ?? null, sortOrder: (last._max.sortOrder ?? -1) + 1 }, select: { id: true, caption: true, fileName: true } });
  }

  async removeImage(id: string) {
    const img = await this.prisma.sitePostImage.findUnique({ where: { id } });
    if (!img) throw new NotFoundException('Photo not found');
    await this.prisma.sitePostImage.delete({ where: { id } });
    await this.storage.delete(img.storageKey);
  }

  // --- Public ------------------------------------------------------------------------------------

  async publicList(limit: number) {
    const rows = await this.prisma.sitePost.findMany({ where: { published: true }, orderBy: { publishedAt: 'desc' }, take: Math.min(30, Math.max(1, limit)), include: { images: { orderBy: { sortOrder: 'asc' }, select: { id: true, caption: true } } } });
    return rows.map((p) => ({ id: p.id, kind: p.kind, title: p.title, body: p.body, eventName: p.eventName, eventDate: p.eventDate, location: p.location, schoolName: p.schoolName, publishedAt: p.publishedAt, images: p.images }));
  }

  async openImage(id: string) {
    const img = await this.prisma.sitePostImage.findFirst({ where: { id, post: { published: true } }, select: { storageKey: true, mimeType: true } });
    if (!img) throw new NotFoundException('Photo not found');
    return { mimeType: img.mimeType, stream: this.storage.read(img.storageKey) };
  }

  private async exists(id: string) {
    if (!(await this.prisma.sitePost.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Post not found');
  }
}

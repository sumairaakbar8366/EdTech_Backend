import { Global, Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { StorageService } from '../storage/storage.service.js';
import { PhotosController, PublicPhotosController } from './photos.controller.js';
import { PhotosService } from './photos.service.js';

/** Global: admissions, hiring, students and staff attach pictures through PhotosService. */
@Global()
@Module({ imports: [RbacModule], controllers: [PhotosController, PublicPhotosController], providers: [PhotosService, StorageService], exports: [PhotosService] })
export class PhotosModule {}

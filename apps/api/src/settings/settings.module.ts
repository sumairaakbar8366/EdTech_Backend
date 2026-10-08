import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { LogoController, SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({ imports: [DocumentsModule], controllers: [SettingsController, LogoController], providers: [SettingsService] })
export class SettingsModule {}

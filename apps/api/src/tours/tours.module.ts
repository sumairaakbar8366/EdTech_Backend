import { Module } from '@nestjs/common';
import { ToursController } from './tours.controller.js';

@Module({ controllers: [ToursController] })
export class ToursModule {}

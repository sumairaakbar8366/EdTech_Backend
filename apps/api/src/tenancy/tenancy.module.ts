import { Global, Module } from '@nestjs/common';
import { TenantController } from './tenant.controller.js';
import { TenantResolverService } from './tenant-resolver.service.js';
import { TenantMiddleware } from './tenant.middleware.js';

@Global()
@Module({
  controllers: [TenantController],
  providers: [TenantResolverService, TenantMiddleware],
  exports: [TenantResolverService, TenantMiddleware],
})
export class TenancyModule {}

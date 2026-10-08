import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountsService } from './accounts.service.js';

@Global()
@Module({
  imports: [AuthModule],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}

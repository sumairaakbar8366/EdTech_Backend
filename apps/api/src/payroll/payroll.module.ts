import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { PayrollController } from './payroll.controller.js';
import { BankAccountsService } from './bank-accounts.service.js';
import { PayrollService } from './payroll.service.js';

@Module({
  imports: [RbacModule],
  controllers: [PayrollController],
  providers: [PayrollService, BankAccountsService],
})
export class PayrollModule {}

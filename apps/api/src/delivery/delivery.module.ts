import { Global, Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service.js';
import { WebUrls } from './web-urls.service.js';

/** Global so any module can send email / SMS / WhatsApp / push by injecting DeliveryService. */
@Global()
@Module({
  providers: [DeliveryService, WebUrls],
  exports: [DeliveryService, WebUrls],
})
export class DeliveryModule {}

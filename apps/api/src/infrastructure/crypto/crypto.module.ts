import { Global, Module } from '@nestjs/common';
import { PiiCryptoService } from './pii-crypto.service';

@Global()
@Module({
  providers: [PiiCryptoService],
  exports: [PiiCryptoService],
})
export class CryptoModule {}

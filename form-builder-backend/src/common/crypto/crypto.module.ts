import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { TotpService } from './totp.service';

@Global()
@Module({
  providers: [CryptoService, TotpService],
  exports: [CryptoService, TotpService],
})
export class CryptoModule {}

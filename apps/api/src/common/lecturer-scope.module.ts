import { Global, Module } from '@nestjs/common';
import { LecturerScopeService } from './lecturer-scope.service';

/** Global so every feature module can inject LecturerScopeService without re-importing. */
@Global()
@Module({
  providers: [LecturerScopeService],
  exports: [LecturerScopeService],
})
export class LecturerScopeModule {}

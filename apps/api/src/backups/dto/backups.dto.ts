import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateBackupDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class RestoreBackupDto {
  @IsIn(['skip', 'overwrite'])
  onConflict!: 'skip' | 'overwrite';
}

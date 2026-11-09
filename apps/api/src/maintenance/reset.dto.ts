import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString } from 'class-validator';

export class ResetDto {
  @ApiProperty({ description: 'Must equal the phrase returned by GET /maintenance/reset-preview' })
  @IsString()
  confirmation!: string;

  @ApiProperty({ description: 'The admin confirms the data was archived (database branch + downloaded backup) first' })
  @IsBoolean()
  archived!: boolean;
}

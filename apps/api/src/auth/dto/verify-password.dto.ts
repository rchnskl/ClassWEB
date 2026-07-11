import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class VerifyPasswordDto {
  @ApiProperty({ description: 'Current password, re-entered to unlock an idle-locked session.' })
  @IsString()
  @MinLength(1)
  password!: string;
}

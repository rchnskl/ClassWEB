import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** Self-service profile fields a user may edit about themselves. */
export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'LINE Messaging API user id, obtained after linking a LINE account' })
  @IsOptional()
  @IsString()
  lineUserId?: string;
}

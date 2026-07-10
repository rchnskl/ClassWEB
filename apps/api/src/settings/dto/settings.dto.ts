import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDefined, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

/** Free-form key/value settings (theme, system name, PDF header/footer, …). */
export class UpsertSettingDto {
  @ApiProperty({ example: 'theme.primaryColor' })
  @IsString()
  key!: string;

  @ApiProperty({ description: 'Any JSON-serialisable value' })
  @IsDefined()
  value!: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class BulkUpsertSettingsDto {
  @ApiProperty({ type: [UpsertSettingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpsertSettingDto)
  settings!: UpsertSettingDto[];
}

/** Structured attendance rule editor (mirrors AttendanceRule columns). */
export class UpdateAttendanceRuleDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  lateAfterMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  autoAbsentAfterMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  lockAfterMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  countWeekend?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  countHoliday?: boolean;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  warningThreshold?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  riskThreshold?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  criticalThreshold?: number;
}

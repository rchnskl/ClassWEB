import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2026' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @ApiProperty({ example: 'Academic Year 2026' })
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameTh?: string;

  @ApiProperty()
  @IsDateString()
  startDate!: string;

  @ApiProperty()
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ description: 'Mark as the current academic year (unsets any other current year)' })
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}

export class UpdateAcademicYearDto extends PartialType(CreateAcademicYearDto) {}

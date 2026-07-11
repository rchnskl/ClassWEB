import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum SemesterTypeDto {
  FIRST = 'FIRST',
  SECOND = 'SECOND',
  SUMMER = 'SUMMER',
  SPECIAL = 'SPECIAL',
}

export class CreateSemesterDto {
  @ApiProperty({ description: 'Academic year id' })
  @IsString()
  academicYearId!: string;

  @ApiProperty({ enum: SemesterTypeDto })
  @IsEnum(SemesterTypeDto)
  type!: SemesterTypeDto;

  @ApiProperty({ example: 'First Semester' })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  addDropDeadline?: string;

  @ApiPropertyOptional({ description: 'Mark as the current semester (unsets any other current semester)' })
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}

export class UpdateSemesterDto extends PartialType(CreateSemesterDto) {}

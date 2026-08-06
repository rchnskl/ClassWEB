import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail, IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { Gender, StudentStatus } from '@prisma/client';

export class CreateStudentDto {
  @ApiProperty({ example: '6510003' })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  studentCode!: string;

  @ApiProperty({ example: 'Somsri Suksan' })
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @ApiPropertyOptional({ example: 'สมศรี สุขสันต์' })
  @IsOptional()
  @IsString()
  nameTh?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiProperty({ description: 'Program id (must belong to the caller\'s tenant)' })
  @IsString()
  programId!: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ enum: StudentStatus })
  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @IsISO8601()
  birthDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  admissionYear?: number;

  @ApiPropertyOptional({ description: 'Current year of study (1–8)', example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  yearLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  citizenId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  passportNo?: string;
}

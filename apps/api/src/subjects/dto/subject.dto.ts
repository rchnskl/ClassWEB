import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { SubjectCategory } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateSubjectDto {
  @ApiProperty({ description: 'Program id' })
  @IsString()
  programId!: string;

  @ApiProperty({ description: 'Course id (subjects belong to a course)' })
  @IsString()
  courseId!: string;

  @ApiProperty({ example: 'NUR1103' })
  @IsString()
  @MinLength(2)
  code!: string;

  @ApiProperty({ example: 'Health Assessment' })
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameTh?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(12)
  credits?: number;

  @ApiPropertyOptional({ enum: SubjectCategory, description: 'หมวดวิชา' })
  @IsOptional()
  @IsEnum(SubjectCategory)
  category?: SubjectCategory;

  @ApiPropertyOptional({ description: 'แผนการเรียน — year of study (1–4) this subject is normally taken in', minimum: 1, maximum: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  yearLevel?: number;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {}

export class QuerySubjectDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional({ enum: SubjectCategory })
  @IsOptional()
  @IsEnum(SubjectCategory)
  category?: SubjectCategory;

  @ApiPropertyOptional({ minimum: 1, maximum: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  yearLevel?: number;
}

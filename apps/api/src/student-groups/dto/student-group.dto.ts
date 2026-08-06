import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength,
} from 'class-validator';
import { StudentGroupScope } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateStudentGroupDto {
  @ApiPropertyOptional({ enum: StudentGroupScope, default: StudentGroupScope.CENTRAL })
  @IsOptional()
  @IsEnum(StudentGroupScope)
  scope?: StudentGroupScope;

  @ApiProperty({ example: 'Year 2 Group 1' })
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @ApiPropertyOptional({ example: 'ปี 2 กลุ่ม 1' })
  @IsOptional()
  @IsString()
  nameTh?: string;

  @ApiPropertyOptional({ example: 'G1' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: 'CENTRAL scope: the cohort this group belongs to' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional({ description: 'CENTRAL scope: year of study (1–8)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  yearLevel?: number;

  @ApiPropertyOptional({ description: 'SECTION scope: the section this ad-hoc group lives in' })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  order?: number;
}

export class UpdateStudentGroupDto extends PartialType(CreateStudentGroupDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryStudentGroupDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: StudentGroupScope })
  @IsOptional()
  @IsEnum(StudentGroupScope)
  scope?: StudentGroupScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  yearLevel?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;
}

export class AddGroupMembersDto {
  @ApiProperty({ type: [String], description: 'Student ids to add (already-present ids are ignored)' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  studentIds!: string[];
}

/** How students are spread across the generated groups. */
export enum SplitStrategy {
  /** Contiguous blocks by student code — matches how printed rosters are grouped. */
  SEQUENTIAL = 'SEQUENTIAL',
  /** Deal one at a time — mixes code ranges across groups. */
  ROUND_ROBIN = 'ROUND_ROBIN',
}

export class AutoSplitDto {
  @ApiProperty({ description: 'How many groups to create', example: 6 })
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(50)
  groupCount!: number;

  @ApiPropertyOptional({ enum: StudentGroupScope, default: StudentGroupScope.CENTRAL })
  @IsOptional()
  @IsEnum(StudentGroupScope)
  scope?: StudentGroupScope;

  @ApiPropertyOptional({ description: 'CENTRAL: split this cohort' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional({ description: 'CENTRAL: split this year of study' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  yearLevel?: number;

  @ApiPropertyOptional({ description: "SECTION: split this section's enrolled roster" })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ enum: SplitStrategy, default: SplitStrategy.SEQUENTIAL })
  @IsOptional()
  @IsEnum(SplitStrategy)
  strategy?: SplitStrategy;

  @ApiPropertyOptional({ description: 'Group name prefix', default: 'Group' })
  @IsOptional()
  @IsString()
  namePrefixEn?: string;

  @ApiPropertyOptional({ description: 'Thai group name prefix', example: 'กลุ่ม' })
  @IsOptional()
  @IsString()
  namePrefixTh?: string;
}

export class EnrollGroupDto {
  @ApiProperty({ description: 'Section to enrol every group member into' })
  @IsString()
  sectionId!: string;
}

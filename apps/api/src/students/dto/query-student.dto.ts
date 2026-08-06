import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { StudentStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class QueryStudentDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by program' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional({ enum: StudentStatus })
  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @ApiPropertyOptional({ description: 'Filter by year of study (1–8)', example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  yearLevel?: number;

  @ApiPropertyOptional({ description: 'Only students who are members of this group' })
  @IsOptional()
  @IsString()
  groupId?: string;
}

/**
 * Query for the central-roster lookup used when building sections and groups.
 * Deliberately narrower than QueryStudentDto: it must be usable by a lecturer
 * who does not (yet) teach the student, so it requires a filter and returns
 * only identifying fields — never contact or identity-document data.
 */
export class LookupStudentDto {
  @ApiPropertyOptional({ description: 'Student code or name fragment (min 2 characters)' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Filter by year of study (1–8)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  yearLevel?: number;

  @ApiPropertyOptional({ description: 'Filter by program' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional({ description: 'Exclude students already enrolled in this section' })
  @IsOptional()
  @IsString()
  excludeSectionId?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take = 20;
}

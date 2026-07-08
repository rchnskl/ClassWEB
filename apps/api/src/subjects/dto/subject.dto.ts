import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
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
}

export class QuerySubjectDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  programId?: string;
}

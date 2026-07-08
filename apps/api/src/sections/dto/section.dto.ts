import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateSectionDto {
  @ApiProperty({ description: 'Subject id' })
  @IsString()
  subjectId!: string;

  @ApiProperty({ description: 'Semester id' })
  @IsString()
  semesterId!: string;

  @ApiProperty({ example: '002' })
  @IsString()
  @MinLength(1)
  sectionNo!: string;

  @ApiPropertyOptional({ description: 'Primary lecturer id' })
  @IsOptional()
  @IsString()
  lecturerId?: string;

  @ApiPropertyOptional({ description: 'Default room id' })
  @IsOptional()
  @IsString()
  roomId?: string;

  @ApiPropertyOptional({ default: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class QuerySectionDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  semesterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lecturerId?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateEnrollmentDto {
  @ApiProperty({ description: 'Section id' })
  @IsString()
  sectionId!: string;

  @ApiProperty({ description: 'Student id' })
  @IsString()
  studentId!: string;
}

export class DropEnrollmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class QueryEnrollmentDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;
}

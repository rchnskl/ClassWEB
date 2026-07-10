import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCourseDto {
  @ApiProperty({ description: 'Program id' })
  @IsString()
  programId!: string;

  @ApiProperty({ example: 'NUR-FND' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;

  @ApiProperty({ example: 'Foundations of Nursing' })
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
}

export class UpdateCourseDto extends PartialType(CreateCourseDto) {}

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProgramDto {
  @ApiProperty({ description: 'Faculty id' })
  @IsString()
  facultyId!: string;

  @ApiProperty({ example: 'BNS' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;

  @ApiProperty({ example: 'Bachelor of Nursing Science' })
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameTh?: string;

  @ApiPropertyOptional({ example: 'Bachelor' })
  @IsOptional()
  @IsString()
  degreeType?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10)
  durationYrs?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  totalCredits?: number;

  @ApiPropertyOptional({ description: 'Buddhist-era year this curriculum revision was approved, e.g. 2565', example: 2565, minimum: 2400, maximum: 2700 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(2400) @Max(2700)
  curriculumYearBE?: number;
}

export class UpdateProgramDto extends PartialType(CreateProgramDto) {}

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDepartmentDto {
  @ApiProperty({ description: 'Faculty id' })
  @IsString()
  facultyId!: string;

  @ApiProperty({ example: 'ADULT' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  code!: string;

  @ApiProperty({ example: 'Adult & Gerontological Nursing' })
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameTh?: string;

  @ApiPropertyOptional({ description: 'Lecturer id who heads this department' })
  @IsOptional()
  @IsString()
  headId?: string;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

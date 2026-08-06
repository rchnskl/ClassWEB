import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateBuildingDto {
  @ApiProperty({ description: 'Campus id' })
  @IsString()
  campusId!: string;

  @ApiProperty({ example: 'CL' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ example: 'Clinical Skills Lab Building' })
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameTh?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  floors?: number;
}

export class UpdateBuildingDto extends PartialType(CreateBuildingDto) {}

export class QueryBuildingDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  campusId?: string;
}

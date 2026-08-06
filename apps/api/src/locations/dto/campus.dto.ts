import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CampusType } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateCampusDto {
  @ApiProperty({ example: 'MAIN' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ example: 'Hua Mak Campus' })
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameTh?: string;

  @ApiPropertyOptional({
    enum: CampusType, default: CampusType.CAMPUS,
    description: 'What kind of site this is — an on-campus location, or an external clinical training site (hospital, health-promoting hospital, health service center, clinic, medical center)',
  })
  @IsOptional()
  @IsEnum(CampusType)
  locationType?: CampusType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;
}

export class UpdateCampusDto extends PartialType(CreateCampusDto) {}

export class QueryCampusDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CampusType })
  @IsOptional()
  @IsEnum(CampusType)
  locationType?: CampusType;
}

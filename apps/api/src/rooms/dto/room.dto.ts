import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateRoomDto {
  @ApiProperty({ description: 'Building id' })
  @IsString()
  buildingId!: string;

  @ApiProperty({ example: 'CL-1103' })
  @IsString()
  @MinLength(1)
  roomNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @ApiPropertyOptional({ default: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  capacity?: number;

  @ApiPropertyOptional({ type: [String], example: ['projector', 'whiteboard'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  equipment?: string[];
}

export class QueryRoomDto extends PaginationQueryDto {}

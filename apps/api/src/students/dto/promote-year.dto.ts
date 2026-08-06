import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PromoteYearDto {
  @ApiProperty({ description: 'Year of study to advance (every STUDYING student at this level moves to the next)', example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  fromYear!: number;

  @ApiPropertyOptional({ description: 'Restrict to one program (default: every program in the faculty)' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiProperty({ description: 'Final year of the curriculum — students at this level graduate instead of advancing', example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  finalYear!: number;

  @ApiPropertyOptional({
    default: false,
    description: 'true = apply the change; false (default) = report what would change without writing',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  commit?: boolean;
}

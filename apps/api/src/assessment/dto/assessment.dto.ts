import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class ScoreEntryDto {
  @ApiProperty()
  @IsString()
  rubricItemId!: string;

  @ApiProperty({ minimum: 0, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  rating!: number;
}

export class SaveEvaluationDto {
  @ApiProperty()
  @IsString()
  rubricId!: string;

  @ApiProperty()
  @IsString()
  studentId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ type: [ScoreEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreEntryDto)
  scores!: ScoreEntryDto[];
}

class WeightDto {
  @IsString() id!: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) weightPercent!: number;
}

export class UpdateRubricWeightsDto {
  @ApiPropertyOptional({ description: "Rubric's overall weight" })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  weightPercent?: number;

  @ApiPropertyOptional({ type: [WeightDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => WeightDto)
  sections?: WeightDto[];

  @ApiPropertyOptional({ type: [WeightDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => WeightDto)
  items?: WeightDto[];
}

class BandDto {
  @IsString() id!: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) minScore!: number;
}

export class UpdateGradeBandsDto {
  @ApiProperty({ type: [BandDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => BandDto)
  bands!: BandDto[];
}

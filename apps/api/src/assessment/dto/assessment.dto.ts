import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

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

class SubjectRubricEntryDto {
  @IsString() rubricId!: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) weightPercent!: number;
  @IsBoolean() isActive!: boolean;
}

export class UpdateSubjectRubricsDto {
  @ApiProperty({ type: [SubjectRubricEntryDto], description: 'Full set of 5 rubric selections for this subject; active weights sum ≤ 100%' })
  @IsArray() @ValidateNested({ each: true }) @Type(() => SubjectRubricEntryDto)
  rubrics!: SubjectRubricEntryDto[];
}

// ---- Rubric builder (create / fully replace structure) --------------------

export class RubricItemInputDto {
  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(2000)
  textEn!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2000)
  textTh?: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  weightPercent!: number;

  @ApiPropertyOptional({ default: 5, minimum: 2, maximum: 10 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(10)
  maxRating?: number;
}

export class RubricSectionInputDto {
  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(300)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(300)
  nameTh?: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  weightPercent!: number;

  @ApiProperty({ type: [RubricItemInputDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RubricItemInputDto)
  items!: RubricItemInputDto[];
}

export class SaveRubricDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(50)
  code?: string;

  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(300)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(300)
  nameTh?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: "Suggested overall weight; actual grading weight per subject comes from SubjectRubric", default: 0 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  weightPercent?: number;

  @ApiProperty({ type: [RubricSectionInputDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RubricSectionInputDto)
  sections!: RubricSectionInputDto[];
}

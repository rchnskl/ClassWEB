import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class ScoreEntryDto {
  @ApiProperty()
  @IsString()
  rubricItemId!: string;

  @ApiProperty({
    minimum: 0,
    description:
      "Score on the item's own 0..maxRating scale. The upper bound is the item's maxRating and is enforced server-side — it is not a fixed 5, because a score component carries its raw mark (e.g. 23.5 out of 25).",
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rating!: number;

  @ApiPropertyOptional({ description: 'Pass/fail for a critical item; ignored for non-critical items' })
  @IsOptional()
  @IsBoolean()
  passed?: boolean;
}

/**
 * Scoring a rubric as a whole instead of item by item. Some components are
 * marked outside the app (a written exam, a case study) and arrive as one
 * number — forcing that through a checklist means inventing per-item marks.
 * Give the raw mark and what it was out of, or the percentage directly.
 */
export class DirectScoreDto {
  @ApiPropertyOptional({ description: 'Raw mark given, e.g. 42. Requires rawMax.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  rawScore?: number;

  @ApiPropertyOptional({ description: 'What the raw mark was out of, e.g. 50.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01)
  rawMax?: number;

  @ApiPropertyOptional({ description: 'The 0–100 score itself, when there is no raw mark to record.' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  scorePercent?: number;
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

  @ApiPropertyOptional({ description: "For a per-session rubric: the class session (practice day) being assessed" })
  @IsOptional()
  @IsString()
  classSessionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ type: [ScoreEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreEntryDto)
  scores!: ScoreEntryDto[];

  @ApiPropertyOptional({ type: DirectScoreDto, description: 'Score the rubric as a whole; item scores are cleared when this is used.' })
  @IsOptional() @ValidateNested() @Type(() => DirectScoreDto)
  direct?: DirectScoreDto;
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
  @ApiPropertyOptional({ description: 'Existing item id — present when editing, so the item (and any scores recorded against it) is updated in place instead of recreated' })
  @IsOptional() @IsString()
  id?: string;

  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(2000)
  textEn!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2000)
  textTh?: string;

  @ApiPropertyOptional({
    minimum: 0, maximum: 100,
    description:
      "How much this item counts within its section. Independent of the full mark — a 50-mark midterm can still be worth 15% of the grade. Omit it and the section is split proportionally to the items' full marks.",
  })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  weightPercent?: number;

  @ApiPropertyOptional({
    default: 5, minimum: 2, maximum: 100,
    description:
      'Top of this item\'s scale — the raw mark it is scored out of (5 for an observation rubric, 25 for a 25-mark midterm). Separate from weightPercent, which is what the mark is worth toward the grade.',
  })
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(100)
  maxRating?: number;

  @ApiPropertyOptional({ description: 'Must-pass step; failing it forces the whole rubric score to 0', default: false })
  @IsOptional() @IsBoolean()
  isCritical?: boolean;
}

export class RubricSectionInputDto {
  @ApiPropertyOptional({ description: 'Existing section id — present when editing, so the section is updated in place instead of recreated' })
  @IsOptional() @IsString()
  id?: string;

  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(300)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(300)
  nameTh?: string;

  @ApiPropertyOptional({
    minimum: 0, maximum: 100,
    description:
      "What this section is worth toward the rubric — set independently of its full marks (a 50-mark midterm section can be worth 15%). Omit it and sections are split proportionally to their full marks.",
  })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  weightPercent?: number;

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

  @ApiPropertyOptional({ description: 'Assessed once per class session (e.g. each practicum day); the component score is the average of the days', default: false })
  @IsOptional() @IsBoolean()
  perSession?: boolean;

  @ApiProperty({ type: [RubricSectionInputDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RubricSectionInputDto)
  sections!: RubricSectionInputDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** What to do when an imported student code already exists in the roster. */
export enum ImportDuplicateMode {
  /** Leave the existing record untouched. */
  SKIP = 'SKIP',
  /** Overwrite the existing record's details with the spreadsheet's. */
  UPDATE = 'UPDATE',
}

export class ImportStudentsDto {
  @ApiProperty({ description: 'Program every imported student belongs to' })
  @IsString()
  programId!: string;

  @ApiPropertyOptional({ description: 'Year of study to apply to every row that does not specify one (1–8)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  yearLevel?: number;

  @ApiPropertyOptional({ enum: ImportDuplicateMode, default: ImportDuplicateMode.SKIP })
  @IsOptional()
  @IsEnum(ImportDuplicateMode)
  onDuplicate?: ImportDuplicateMode;

  @ApiPropertyOptional({
    default: false,
    description: 'true = write to the database; false (default) = validate only and return the preview',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  commit?: boolean;
}

/** One parsed spreadsheet row after validation. */
export interface ImportRowResult {
  /** 1-based row number in the uploaded sheet, so the user can find it. */
  row: number;
  studentCode: string;
  nameEn: string;
  nameTh: string | null;
  nickname: string | null;
  gender: string | null;
  email: string | null;
  phone: string | null;
  yearLevel: number | null;
  /** What will happen (preview) or what happened (commit). */
  action: 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';
  errors: string[];
}

export interface ImportSummary {
  fileName: string;
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  errors: number;
  committed: boolean;
  /** Set only on a committed run — lets an import be traced in the audit log. */
  importBatch?: string;
  rows: ImportRowResult[];
}

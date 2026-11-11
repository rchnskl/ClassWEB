import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

class CaseFieldsDto {
  @ApiPropertyOptional({ example: '12' }) @IsOptional() @IsString() @MaxLength(30) bed?: string;
  @ApiPropertyOptional({ example: '6512345' }) @IsOptional() @IsString() @MaxLength(30) hn?: string;
  @ApiPropertyOptional({ example: 'ด.ช. ก.' }) @IsOptional() @IsString() @MaxLength(120) patientName?: string;
  @ApiPropertyOptional({ example: '2 ปี 3 เดือน' }) @IsOptional() @IsString() @MaxLength(40) patientAge?: string;
  @ApiPropertyOptional({ example: 'Pneumonia' }) @IsOptional() @IsString() @MaxLength(300) diagnosis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class CreateCaseDto extends CaseFieldsDto {
  @ApiProperty({ description: 'Practice day (class session) id' })
  @IsString()
  classSessionId!: string;

  @ApiProperty({ type: [String], description: 'Students caring for this patient (usually a pair)' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsString({ each: true })
  studentIds!: string[];
}

export class UpdateCaseDto extends CaseFieldsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsString({ each: true })
  studentIds?: string[];
}

export class CreateDailyNoteDto {
  @ApiProperty() @IsString() classSessionId!: string;
  @ApiProperty() @IsString() studentId!: string;
  @ApiProperty({ example: 'เตรียมข้อมูลผู้ป่วยมาครบ ตอบคำถามเรื่องยาได้ดี' })
  @IsString() @MinLength(1) @MaxLength(4000)
  content!: string;
}

export class CarryForwardDto {
  @ApiProperty({ description: 'Practice day to carry the cases into' }) @IsString() classSessionId!: string;
  @ApiProperty({ type: [String], description: 'Cases from an earlier practice day of the same section' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @IsString({ each: true })
  caseIds!: string[];
}

export class DischargeCaseDto {
  @ApiProperty({ description: 'true = the patient went home; false = undo' }) @IsBoolean() discharged!: boolean;
}

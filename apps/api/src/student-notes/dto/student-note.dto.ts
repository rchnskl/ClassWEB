import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { StudentNoteCategory } from '@prisma/client';

export class CreateStudentNoteDto {
  @ApiProperty({ enum: StudentNoteCategory, example: 'BEHAVIOR' })
  @IsEnum(StudentNoteCategory)
  category!: StudentNoteCategory;

  @ApiProperty({ example: 'มาสายเกิน 30 นาที และไม่ส่งงานที่มอบหมาย' })
  @IsString()
  @MinLength(1)
  content!: string;

  @ApiPropertyOptional({ description: 'Flag as misconduct for quick filtering' })
  @IsOptional()
  @IsBoolean()
  flagged?: boolean;
}

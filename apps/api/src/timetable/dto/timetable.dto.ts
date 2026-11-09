import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DayOfWeek } from '@prisma/client';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateScheduleDto {
  @ApiProperty({ description: 'Section id' })
  @IsString()
  sectionId!: string;

  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @ApiProperty({ example: '13:00', description: '24h HH:mm' })
  @Matches(TIME, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @ApiProperty({ example: '16:00' })
  @Matches(TIME, { message: 'endTime must be HH:mm' })
  endTime!: string;

  @ApiPropertyOptional({ description: 'Room id (defaults to the section room)' })
  @IsOptional()
  @IsString()
  roomId?: string;

  @ApiPropertyOptional({ description: 'Lecturer id (defaults to the section lecturer)' })
  @IsOptional()
  @IsString()
  lecturerId?: string;
}

export class TimetableQueryDto {
  @ApiPropertyOptional({ description: 'Filter by semester (defaults to current)' })
  @IsOptional()
  @IsString()
  semesterId?: string;
}

export class GenerateSessionsDto {
  @ApiProperty({ description: 'Section id whose schedule to expand into class sessions' })
  @IsString()
  sectionId!: string;
}


const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Concrete sessions on chosen dates — for blocks that don't repeat weekly,
 * such as clinical practicum days (10–12 and 17–19 Nov) or a one-off
 * case-presentation day.
 */
export class CreateDatedSessionsDto {
  @ApiProperty({ description: 'Section id' })
  @IsString()
  sectionId!: string;

  @ApiProperty({ type: [String], example: ['2026-11-10', '2026-11-11'], description: 'Dates, YYYY-MM-DD' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(60)
  @Matches(DATE, { each: true, message: 'each date must be YYYY-MM-DD' })
  dates!: string[];

  @ApiProperty({ example: '07:00' })
  @Matches(TIME, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @ApiProperty({ example: '16:00' })
  @Matches(TIME, { message: 'endTime must be HH:mm' })
  endTime!: string;

  @ApiPropertyOptional({ description: 'Room / ward id (defaults to the section room)' })
  @IsOptional()
  @IsString()
  roomId?: string;

  @ApiPropertyOptional({ description: 'Lecturer id (defaults to the section lecturer)' })
  @IsOptional()
  @IsString()
  lecturerId?: string;

  @ApiPropertyOptional({ example: 'Clinical practice', description: 'What happens in these sessions' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  @ApiPropertyOptional({ default: true, description: 'Offer these days for per-session (daily) assessment; false for e.g. a presentation day' })
  @IsOptional()
  @IsBoolean()
  dailyAssessment?: boolean;
}

export class UpdateSessionDto {
  @ApiPropertyOptional({ example: 'Case presentation' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  @ApiPropertyOptional({ description: 'Offer this day for per-session (daily) assessment' })
  @IsOptional()
  @IsBoolean()
  dailyAssessment?: boolean;
}

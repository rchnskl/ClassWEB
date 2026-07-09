import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
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

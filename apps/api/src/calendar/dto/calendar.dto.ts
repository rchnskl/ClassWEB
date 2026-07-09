import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';
import { CalendarEntryType, CalendarVisibility } from '@prisma/client';

export class CreateCalendarEntryDto {
  @ApiProperty({ enum: CalendarEntryType, example: 'PERSONAL' })
  @IsEnum(CalendarEntryType)
  type!: CalendarEntryType;

  @ApiProperty({ example: 'Advising meeting with Year 2' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '2026-07-09T14:00:00.000Z' })
  @IsISO8601()
  startAt!: string;

  @ApiProperty({ example: '2026-07-09T15:00:00.000Z' })
  @IsISO8601()
  endAt!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roomId?: string;

  @ApiPropertyOptional({ description: 'Owning lecturer (personal/activity)' })
  @IsOptional()
  @IsString()
  lecturerId?: string;

  @ApiPropertyOptional({ enum: CalendarVisibility })
  @IsOptional()
  @IsEnum(CalendarVisibility)
  visibility?: CalendarVisibility;

  @ApiPropertyOptional({ example: '#ff8a4c' })
  @IsOptional()
  @IsString()
  color?: string;
}

export class QueryCalendarDto {
  @ApiProperty({ description: 'Range start (ISO8601)' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ description: 'Range end (ISO8601)' })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional({ enum: CalendarEntryType })
  @IsOptional()
  @IsEnum(CalendarEntryType)
  type?: CalendarEntryType;
}

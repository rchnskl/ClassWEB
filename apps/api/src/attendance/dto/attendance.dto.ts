import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { AttendanceResolutionReason, AttendanceStatus } from '@prisma/client';

/** Student self check-in via the QR token (public endpoint). */
export class CheckInDto {
  @ApiProperty({ description: 'Attendance session token from the QR' })
  @IsString()
  token!: string;

  @ApiProperty({ example: '6510001', description: 'The student\'s own student code' })
  @IsString()
  @MinLength(3)
  studentCode!: string;

  @ApiPropertyOptional({ description: 'Set true to confirm check-in with an unmatched code (after the student verifies it is correct)' })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

/** Lecturer manual marking. */
export class ManualMarkDto {
  @ApiProperty()
  @IsString()
  classSessionId!: string;

  @ApiProperty()
  @IsString()
  studentId!: string;

  @ApiProperty({ enum: AttendanceStatus })
  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;
}

/** Lecturer resolves a PENDING check-in. */
export class ResolveCheckInDto {
  @ApiProperty({ enum: ['ACCEPT', 'REJECT'] })
  @IsIn(['ACCEPT', 'REJECT'])
  action!: 'ACCEPT' | 'REJECT';

  @ApiProperty({ enum: AttendanceResolutionReason })
  @IsEnum(AttendanceResolutionReason)
  reason!: AttendanceResolutionReason;

  @ApiPropertyOptional({ enum: AttendanceStatus, description: 'Resulting status if accepted (default PRESENT)' })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reasonNote?: string;
}

/** A section's own attendance rule. */
export class SectionRuleDto {
  @ApiProperty({ example: 30, description: 'A check-in this many minutes after the start or later is LATE' })
  @IsInt() @Min(0) @Max(600)
  lateAfterMinutes!: number;

  @ApiProperty({ example: 240, description: 'A check-in this many minutes after the start or later is ABSENT' })
  @IsInt() @Min(0) @Max(1440)
  autoAbsentAfterMinutes!: number;

  @ApiPropertyOptional({ example: 15, nullable: true, description: 'Check-in opens this many minutes before the start; omit/null = from the start of the day' })
  @IsOptional() @IsInt() @Min(0) @Max(720)
  opensBeforeMinutes?: number | null;
}

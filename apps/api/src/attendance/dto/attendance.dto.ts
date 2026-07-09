import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
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

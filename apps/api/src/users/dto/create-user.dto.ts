import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'wichai.s@nursing.au.edu' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['ADMIN', 'LECTURER', 'STUDENT'] })
  @IsIn(['ADMIN', 'LECTURER', 'STUDENT'])
  roleCode!: string;

  @ApiPropertyOptional({ description: 'Link this new login to an existing Lecturer record that has no account yet' })
  @IsOptional()
  @IsString()
  lecturerId?: string;

  @ApiPropertyOptional({ description: 'Link this new login to an existing Student record that has no account yet' })
  @IsOptional()
  @IsString()
  studentId?: string;
}

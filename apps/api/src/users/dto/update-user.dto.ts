import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

  @ApiPropertyOptional({ enum: ['ADMIN', 'LECTURER', 'STUDENT'], description: 'Replaces all of this user\'s role assignments with this single role' })
  @IsOptional()
  @IsIn(['ADMIN', 'LECTURER', 'STUDENT'])
  roleCode?: string;

  @ApiPropertyOptional({ description: 'Name shown for this login in reports when it has no lecturer/student profile (e.g. a shared admin account). Empty clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;
}

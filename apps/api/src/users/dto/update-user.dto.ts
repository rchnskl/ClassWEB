import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

  @ApiPropertyOptional({ enum: ['ADMIN', 'LECTURER', 'STUDENT'], description: 'Replaces all of this user\'s role assignments with this single role' })
  @IsOptional()
  @IsIn(['ADMIN', 'LECTURER', 'STUDENT'])
  roleCode?: string;
}

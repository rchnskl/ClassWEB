import { ApiProperty } from '@nestjs/swagger';
import { SubjectMemberRole } from '@prisma/client';
import { IsEnum, IsString } from 'class-validator';

export class JoinSubjectDto {
  @ApiProperty({ enum: SubjectMemberRole, description: 'The role the caller wants to take on for this subject' })
  @IsEnum(SubjectMemberRole)
  role!: SubjectMemberRole;
}

export class AddTeamMemberDto {
  @ApiProperty()
  @IsString()
  lecturerId!: string;

  @ApiProperty({ enum: SubjectMemberRole, default: SubjectMemberRole.TEAM_MEMBER })
  @IsEnum(SubjectMemberRole)
  role: SubjectMemberRole = SubjectMemberRole.TEAM_MEMBER;
}

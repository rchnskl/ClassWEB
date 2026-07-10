import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AcademicService } from './academic.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('academic')
@ApiBearerAuth()
@Controller()
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @Get('departments')
  @Permissions('faculty:read')
  @ApiOperation({ summary: 'List departments in the tenant' })
  departments(@CurrentUser() user: AuthenticatedUser) {
    return this.academic.departments(user.universityId);
  }

  @Get('programs')
  @Permissions('program:read')
  @ApiOperation({ summary: 'List programs in the tenant' })
  programs(@CurrentUser() user: AuthenticatedUser) {
    return this.academic.programs(user.universityId);
  }

  @Get('academic-years')
  @Permissions('academicYear:read')
  @ApiOperation({ summary: 'List academic years' })
  years(@CurrentUser() user: AuthenticatedUser) {
    return this.academic.academicYears(user.universityId);
  }

  @Get('semesters')
  @Permissions('semester:read')
  @ApiOperation({ summary: 'List semesters' })
  semesters(@CurrentUser() user: AuthenticatedUser) {
    return this.academic.semesters(user.universityId);
  }
}

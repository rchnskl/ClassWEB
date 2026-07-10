import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AcademicService } from './academic.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { CreateCourseDto, UpdateCourseDto } from './dto/course.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('academic')
@ApiBearerAuth()
@Controller()
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @Get('departments')
  @Permissions('department:read')
  @ApiOperation({ summary: 'List departments in the tenant' })
  departments(@CurrentUser() user: AuthenticatedUser) {
    return this.academic.departments(user.universityId);
  }

  @Post('departments')
  @Permissions('department:create')
  @ApiOperation({ summary: 'Create a department' })
  createDepartment(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDepartmentDto) {
    return this.academic.createDepartment(user.universityId, dto);
  }

  @Patch('departments/:id')
  @Permissions('department:update')
  @ApiOperation({ summary: 'Update a department' })
  updateDepartment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.academic.updateDepartment(user.universityId, id, dto);
  }

  @Delete('departments/:id')
  @Permissions('department:delete')
  @ApiOperation({ summary: 'Delete a department (blocked if lecturers are assigned)' })
  removeDepartment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.academic.removeDepartment(user.universityId, id);
  }

  @Get('courses')
  @Permissions('course:read')
  @ApiOperation({ summary: 'List courses in the tenant, optionally filtered by program' })
  courses(@CurrentUser() user: AuthenticatedUser, @Query('programId') programId?: string) {
    return this.academic.courses(user.universityId, programId);
  }

  @Post('courses')
  @Permissions('course:create')
  @ApiOperation({ summary: 'Create a course' })
  createCourse(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCourseDto) {
    return this.academic.createCourse(user.universityId, dto);
  }

  @Patch('courses/:id')
  @Permissions('course:update')
  @ApiOperation({ summary: 'Update a course' })
  updateCourse(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.academic.updateCourse(user.universityId, id, dto);
  }

  @Delete('courses/:id')
  @Permissions('course:delete')
  @ApiOperation({ summary: 'Delete a course (blocked if subjects are assigned)' })
  removeCourse(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.academic.removeCourse(user.universityId, id);
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

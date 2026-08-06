import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto, DropEnrollmentDto, QueryEnrollmentDto } from './dto/enrollment.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('enrollments')
@ApiBearerAuth()
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @Permissions('enrollment:read')
  @ApiOperation({ summary: 'List enrollments (filter by section or student)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryEnrollmentDto) {
    return this.enrollments.list(user, query);
  }

  @Post()
  @Permissions('enrollment:create')
  @ApiOperation({ summary: 'Enrol a student into a section (capacity-checked)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEnrollmentDto) {
    return this.enrollments.create(user, dto);
  }

  @Patch(':id/drop')
  @Permissions('enrollment:update')
  @ApiOperation({ summary: 'Drop an enrollment' })
  drop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DropEnrollmentDto,
  ) {
    return this.enrollments.drop(user, id, dto.reason);
  }
}

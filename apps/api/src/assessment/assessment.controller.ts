import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssessmentService } from './assessment.service';
import { SaveEvaluationDto, UpdateGradeBandsDto, UpdateRubricWeightsDto, UpdateSubjectRubricsDto } from './dto/assessment.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('assessment')
@ApiBearerAuth()
@Controller('assessment')
export class AssessmentController {
  constructor(private readonly assessment: AssessmentService) {}

  @Get('rubrics')
  @Permissions('assessment:read')
  @ApiOperation({ summary: 'List rubrics (with sections + items)' })
  rubrics(@CurrentUser() user: AuthenticatedUser) {
    return this.assessment.listRubrics(user.universityId);
  }

  @Get('rubrics/:id')
  @Permissions('assessment:read')
  rubric(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.assessment.getRubric(user.universityId, id);
  }

  @Patch('rubrics/:id/weights')
  @Permissions('assessment:update')
  @ApiOperation({ summary: 'Adjust rubric / section / item weights (sums ≤ 100%)' })
  weights(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateRubricWeightsDto) {
    return this.assessment.updateWeights(user.universityId, id, dto);
  }

  @Get('subjects/:subjectId/rubric-config')
  @Permissions('assessment:read')
  @ApiOperation({ summary: 'All 5 rubrics with this subject\'s active/weight selection (for the config UI)' })
  subjectRubricConfig(@CurrentUser() user: AuthenticatedUser, @Param('subjectId') subjectId: string) {
    return this.assessment.subjectRubricConfig(user.universityId, subjectId);
  }

  @Patch('subjects/:subjectId/rubric-config')
  @Permissions('assessment:update')
  @ApiOperation({ summary: 'Choose which rubrics this subject uses + their weight (active weights sum ≤ 100%)' })
  updateSubjectRubricConfig(@CurrentUser() user: AuthenticatedUser, @Param('subjectId') subjectId: string, @Body() dto: UpdateSubjectRubricsDto) {
    return this.assessment.updateSubjectRubrics(user.universityId, subjectId, dto);
  }

  @Get('subjects/:subjectId/rubrics')
  @Permissions('assessment:read')
  @ApiOperation({ summary: "Full rubric objects (bilingual, sections+items) this subject actually uses — for grading" })
  activeRubrics(@CurrentUser() user: AuthenticatedUser, @Param('subjectId') subjectId: string) {
    return this.assessment.activeRubricsForSubject(user.universityId, subjectId);
  }

  @Get('grade-scheme')
  @Permissions('assessment:read')
  @ApiOperation({ summary: 'Get the editable grade scheme (score bands → A–F)' })
  gradeScheme(@CurrentUser() user: AuthenticatedUser) {
    return this.assessment.gradeScheme(user.universityId);
  }

  @Patch('grade-scheme')
  @Permissions('assessment:update')
  @ApiOperation({ summary: 'Edit grade band score ranges' })
  updateBands(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateGradeBandsDto) {
    return this.assessment.updateBands(user.universityId, dto);
  }

  @Get('evaluation')
  @Permissions('assessment:read')
  @ApiOperation({ summary: "A student's existing scores for a rubric (for the grading form)" })
  evaluation(
    @CurrentUser() user: AuthenticatedUser,
    @Query('rubricId') rubricId: string,
    @Query('studentId') studentId: string,
    @Query('sectionId') sectionId?: string,
  ) {
    return this.assessment.getEvaluation(user.universityId, rubricId, studentId, sectionId);
  }

  @Post('evaluation')
  @Permissions('assessment:create')
  @ApiOperation({ summary: 'Save an evaluation (rate items 1–5); computes the rubric score' })
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveEvaluationDto) {
    return this.assessment.save(user.universityId, user.id, user.email, dto);
  }

  @Get('students/:studentId/summary')
  @Permissions('assessment:read')
  @ApiOperation({ summary: 'Per-student breakdown across rubrics + total + grade' })
  studentSummary(@CurrentUser() user: AuthenticatedUser, @Param('studentId') studentId: string, @Query('sectionId') sectionId?: string) {
    return this.assessment.studentSummary(user.universityId, studentId, sectionId);
  }

  @Get('sections/:sectionId/summary')
  @Permissions('assessment:read')
  @ApiOperation({ summary: 'Per-section grade sheet: every student with total + grade' })
  sectionSummary(@CurrentUser() user: AuthenticatedUser, @Param('sectionId') sectionId: string) {
    return this.assessment.sectionSummary(user.universityId, sectionId);
  }
}

import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('attendance.pdf')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Attendance summary report — professional PDF (logos, signature, QR verify)' })
  async pdf(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { buffer, reportNumber } = await this.reports.attendancePdf(user, user.id, user.email);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.pdf"`);
    res.send(buffer);
  }

  @Get('attendance.csv')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Attendance summary — CSV' })
  async csv(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { content, reportNumber } = await this.reports.attendanceCsv(user, user.id, user.email);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.csv"`);
    res.send(content);
  }

  @Get('attendance.xlsx')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Attendance summary — Excel' })
  async xlsx(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { buffer, reportNumber } = await this.reports.attendanceXlsx(user, user.id, user.email);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.xlsx"`);
    res.send(buffer);
  }

  @Get('student/:studentId/pdf')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Individual student attendance report — PDF' })
  async studentPdf(@CurrentUser() user: AuthenticatedUser, @Param('studentId') studentId: string, @Res() res: Response) {
    const { buffer, reportNumber } = await this.reports.studentPdf(user.universityId, studentId, user.id, user.email);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.pdf"`);
    res.send(buffer);
  }

  @Get('student/:studentId/csv')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Individual student attendance report — CSV' })
  async studentCsv(@CurrentUser() user: AuthenticatedUser, @Param('studentId') studentId: string, @Res() res: Response) {
    const { content, reportNumber } = await this.reports.studentCsv(user.universityId, studentId, user.id, user.email);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.csv"`);
    res.send(content);
  }

  @Get('student/:studentId/xlsx')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Individual student attendance report — Excel' })
  async studentXlsx(@CurrentUser() user: AuthenticatedUser, @Param('studentId') studentId: string, @Res() res: Response) {
    const { buffer, reportNumber } = await this.reports.studentXlsx(user.universityId, studentId, user.id, user.email);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.xlsx"`);
    res.send(buffer);
  }

  // ---- Grade reports: per-section grade sheet ----------------------------

  @Get('grades/section/:sectionId/pdf')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Section grade sheet — landscape PDF (per-rubric scores + total + grade for every student)' })
  async sectionGradesPdf(@CurrentUser() user: AuthenticatedUser, @Param('sectionId') sectionId: string, @Res() res: Response) {
    const { buffer, reportNumber } = await this.reports.sectionGradesPdf(user, sectionId, user.id, user.email);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.pdf"`);
    res.send(buffer);
  }

  @Get('grades/section/:sectionId/csv')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Section grade sheet — CSV' })
  async sectionGradesCsv(@CurrentUser() user: AuthenticatedUser, @Param('sectionId') sectionId: string, @Res() res: Response) {
    const { content, reportNumber } = await this.reports.sectionGradesCsv(user, sectionId, user.id, user.email);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.csv"`);
    res.send(content);
  }

  @Get('grades/section/:sectionId/xlsx')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Section grade sheet — Excel' })
  async sectionGradesXlsx(@CurrentUser() user: AuthenticatedUser, @Param('sectionId') sectionId: string, @Res() res: Response) {
    const { buffer, reportNumber } = await this.reports.sectionGradesXlsx(user, sectionId, user.id, user.email);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.xlsx"`);
    res.send(buffer);
  }

  // ---- Grade reports: per-student breakdown -------------------------------

  @Get('grades/student/:studentId/pdf')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Individual student grade report — PDF (rubric breakdown + total + grade, signature, QR verify)' })
  async studentGradePdf(@CurrentUser() user: AuthenticatedUser, @Param('studentId') studentId: string, @Query('sectionId') sectionId: string, @Res() res: Response) {
    if (!sectionId) throw new BadRequestException('sectionId is required');
    const { buffer, reportNumber } = await this.reports.studentGradePdf(user, studentId, sectionId, user.id, user.email);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.pdf"`);
    res.send(buffer);
  }

  @Get('grades/student/:studentId/csv')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Individual student grade report — CSV' })
  async studentGradeCsv(@CurrentUser() user: AuthenticatedUser, @Param('studentId') studentId: string, @Query('sectionId') sectionId: string, @Res() res: Response) {
    if (!sectionId) throw new BadRequestException('sectionId is required');
    const { content, reportNumber } = await this.reports.studentGradeCsv(user, studentId, sectionId, user.id, user.email);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.csv"`);
    res.send(content);
  }

  @Get('grades/student/:studentId/xlsx')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Individual student grade report — Excel' })
  async studentGradeXlsx(@CurrentUser() user: AuthenticatedUser, @Param('studentId') studentId: string, @Query('sectionId') sectionId: string, @Res() res: Response) {
    if (!sectionId) throw new BadRequestException('sectionId is required');
    const { buffer, reportNumber } = await this.reports.studentGradeXlsx(user, studentId, sectionId, user.id, user.email);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.xlsx"`);
    res.send(buffer);
  }

  @Public()
  @Get('verify/:reportNumber')
  @ApiOperation({ summary: 'Public report verification (QR target)' })
  verify(@Param('reportNumber') reportNumber: string) {
    return this.reports.verify(reportNumber);
  }

  @Public()
  @Get('file/:reportNumber')
  @ApiOperation({ summary: 'The actual generated file behind a report — what the QR code opens' })
  async file(@Param('reportNumber') reportNumber: string, @Res() res: Response) {
    const { content, contentType } = await this.reports.file(reportNumber);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${reportNumber}.pdf"`);
    res.send(content);
  }
}

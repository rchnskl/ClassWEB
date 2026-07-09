import { Controller, Get, Param, Res } from '@nestjs/common';
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
    const { buffer, reportNumber } = await this.reports.attendancePdf(user.universityId, user.id, user.email);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.pdf"`);
    res.send(buffer);
  }

  @Get('attendance.csv')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Attendance summary — CSV' })
  async csv(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { content, reportNumber } = await this.reports.attendanceCsv(user.universityId, user.id, user.email);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reportNumber}.csv"`);
    res.send(content);
  }

  @Get('attendance.xlsx')
  @ApiBearerAuth()
  @Permissions('report:export')
  @ApiOperation({ summary: 'Attendance summary — Excel' })
  async xlsx(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { buffer, reportNumber } = await this.reports.attendanceXlsx(user.universityId, user.id, user.email);
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
}

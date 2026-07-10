import { Body, Controller, Delete, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BackupsService } from './backups.service';
import { CreateBackupDto } from './dto/backups.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('backups')
@ApiBearerAuth()
@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  @Permissions('backup:read')
  @ApiOperation({ summary: 'List backups for this tenant' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.backups.list(user.universityId);
  }

  @Post()
  @Permissions('backup:create')
  @ApiOperation({ summary: 'Snapshot all tenant business data to a downloadable backup' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBackupDto) {
    return this.backups.create(user.universityId, user.id, dto.note);
  }

  @Delete(':id')
  @Permissions('backup:delete')
  @ApiOperation({ summary: 'Delete a backup record and its file' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.backups.remove(user.universityId, id);
  }

  @Get(':id/download')
  @Permissions('backup:read')
  @ApiOperation({ summary: 'Download the raw backup file (gzip JSON)' })
  async download(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Res() res: Response) {
    const { backup, gz } = await this.backups.fileFor(user.universityId, id);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.fileName}"`);
    res.send(gz);
  }

  @Post(':id/restore')
  @Permissions('backup:create')
  @ApiOperation({ summary: 'Restore missing rows from a backup into this tenant (never overwrites existing data)' })
  restore(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.backups.restore(user.universityId, id);
  }
}

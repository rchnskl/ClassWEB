import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CasesService } from './cases.service';
import { CarryForwardDto, CreateCaseDto, CreateDailyNoteDto, DischargeCaseDto, UpdateCaseDto } from './dto/cases.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get()
  @Permissions('note:read')
  @ApiOperation({ summary: "A practice day's patient cases and each student's notes for that day" })
  day(@CurrentUser() user: AuthenticatedUser, @Query('classSessionId') classSessionId: string) {
    return this.cases.day(user, classSessionId);
  }

  @Post()
  @Permissions('note:create')
  @ApiOperation({ summary: 'Assign a patient case (bed, HN, name, age) to students for a practice day' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCaseDto) {
    return this.cases.create(user, dto);
  }

  @Post('carry-forward')
  @Permissions('note:create')
  @ApiOperation({ summary: "Carry cases from an earlier practice day into this one (same patient, same students)" })
  carryForward(@CurrentUser() user: AuthenticatedUser, @Body() dto: CarryForwardDto) {
    return this.cases.carryForward(user, dto);
  }

  @Patch(':id/discharge')
  @Permissions('note:update')
  @ApiOperation({ summary: 'Mark that the patient went home (or undo)' })
  discharge(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: DischargeCaseDto) {
    return this.cases.discharge(user, id, dto);
  }

  @Patch(':id')
  @Permissions('note:update')
  @ApiOperation({ summary: 'Edit a case or who is assigned to it' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCaseDto) {
    return this.cases.update(user, id, dto);
  }

  @Delete(':id')
  @Permissions('note:delete')
  @ApiOperation({ summary: 'Remove a case' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cases.remove(user, id);
  }

  @Post('notes')
  @Permissions('note:create')
  @ApiOperation({ summary: "Add a note on a student for a practice day (append-only, stamped with the recorder)" })
  addNote(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDailyNoteDto) {
    return this.cases.addNote(user, dto);
  }
}

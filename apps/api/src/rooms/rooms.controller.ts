import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { CreateRoomDto, QueryRoomDto } from './dto/room.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('rooms')
@ApiBearerAuth()
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @Permissions('room:read')
  @ApiOperation({ summary: 'List rooms (tenant-scoped, searchable, paginated)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryRoomDto) {
    return this.rooms.list(user.universityId, query);
  }

  @Get(':id')
  @Permissions('room:read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rooms.get(user.universityId, id);
  }

  @Post()
  @Permissions('room:create')
  @ApiOperation({ summary: 'Create a room' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRoomDto) {
    return this.rooms.create(user.universityId, dto);
  }

  @Patch(':id')
  @Permissions('room:update')
  @ApiOperation({ summary: 'Update a room' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Partial<CreateRoomDto>) {
    return this.rooms.update(user.universityId, id, dto);
  }

  @Delete(':id')
  @Permissions('room:delete')
  @ApiOperation({ summary: 'Delete a room (blocked if used by a section or class session)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rooms.remove(user.universityId, id);
  }
}

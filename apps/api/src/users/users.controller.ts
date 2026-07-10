import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update self-editable profile fields (currently: lineUserId)' })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Get('roles')
  @Permissions('user:read')
  @ApiOperation({ summary: 'Available roles in this tenant (for a role picker)' })
  roles(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.listRoles(user.universityId);
  }

  @Get('linkable-lecturers')
  @Permissions('user:read')
  @ApiOperation({ summary: 'Lecturers with no login account yet' })
  linkableLecturers(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.linkableLecturers(user.universityId);
  }

  @Get('linkable-students')
  @Permissions('user:read')
  @ApiOperation({ summary: 'Students with no login account yet' })
  linkableStudents(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.linkableStudents(user.universityId);
  }

  @Get()
  @Permissions('user:read')
  @ApiOperation({ summary: 'List users in the caller\'s tenant (requires user:read)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.usersService.listByTenant(
      user.universityId,
      take ? Math.min(parseInt(take, 10) || 50, 200) : 50,
      skip ? parseInt(skip, 10) || 0 : 0,
    );
  }

  @Post()
  @Permissions('user:create')
  @ApiOperation({ summary: 'Create a login account (optionally linked to an existing Lecturer/Student); returns a one-time temp password' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.usersService.createUser(user.universityId, dto);
  }

  @Patch(':id')
  @Permissions('user:update')
  @ApiOperation({ summary: "Update a user's status and/or role" })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateUser(user.universityId, id, dto);
  }

  @Post(':id/reset-password')
  @Permissions('user:update')
  @ApiOperation({ summary: 'Reset a user\'s password; returns a one-time temp password and revokes their sessions' })
  resetPassword(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.resetPassword(user.universityId, id);
  }
}

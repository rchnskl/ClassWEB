import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocationsService } from './locations.service';
import { CreateCampusDto, QueryCampusDto, UpdateCampusDto } from './dto/campus.dto';
import { CreateBuildingDto, QueryBuildingDto, UpdateBuildingDto } from './dto/building.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('campuses')
  @Permissions('room:read')
  @ApiOperation({ summary: 'List locations — campuses and external clinical sites (hospitals, clinics, etc.)' })
  listCampuses(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryCampusDto) {
    return this.locations.listCampuses(user.universityId, query);
  }

  @Post('campuses')
  @Permissions('room:create')
  @ApiOperation({ summary: 'Create a location (campus or external clinical site)' })
  createCampus(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCampusDto) {
    return this.locations.createCampus(user.universityId, dto);
  }

  @Patch('campuses/:id')
  @Permissions('room:update')
  updateCampus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCampusDto) {
    return this.locations.updateCampus(user.universityId, id, dto);
  }

  @Delete('campuses/:id')
  @Permissions('room:delete')
  @ApiOperation({ summary: 'Delete a location (blocked if it has buildings)' })
  removeCampus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.locations.removeCampus(user.universityId, id);
  }

  @Get('buildings')
  @Permissions('room:read')
  listBuildings(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryBuildingDto) {
    return this.locations.listBuildings(user.universityId, query);
  }

  @Post('buildings')
  @Permissions('room:create')
  createBuilding(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBuildingDto) {
    return this.locations.createBuilding(user.universityId, dto);
  }

  @Patch('buildings/:id')
  @Permissions('room:update')
  updateBuilding(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateBuildingDto) {
    return this.locations.updateBuilding(user.universityId, id, dto);
  }

  @Delete('buildings/:id')
  @Permissions('room:delete')
  @ApiOperation({ summary: 'Delete a building (blocked if it has rooms)' })
  removeBuilding(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.locations.removeBuilding(user.universityId, id);
  }
}

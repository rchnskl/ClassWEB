import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Paginated } from '../common/dto/pagination.dto';
import { CreateCampusDto, QueryCampusDto, UpdateCampusDto } from './dto/campus.dto';
import { CreateBuildingDto, QueryBuildingDto, UpdateBuildingDto } from './dto/building.dto';

/**
 * สถานที่เรียน — campuses and buildings, spanning both on-campus locations
 * and external clinical training sites (hospitals, health-promoting
 * hospitals, health service centers, clinics, medical centers). A clinical
 * site is just a Campus with locationType != CAMPUS; its wards/departments
 * are Buildings, and its actual bookable spaces are Rooms — same hierarchy,
 * no separate models needed.
 */
@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- campuses -----------------------------------------------------------

  private campusSelect = {
    id: true, code: true, nameEn: true, nameTh: true, locationType: true, address: true, city: true, isActive: true,
    _count: { select: { buildings: true } },
  } satisfies Prisma.CampusSelect;

  async listCampuses(universityId: string, query: QueryCampusDto): Promise<Paginated<unknown>> {
    const where: Prisma.CampusWhereInput = {
      universityId, deletedAt: null,
      ...(query.locationType ? { locationType: query.locationType } : {}),
      ...(query.search
        ? { OR: [
            { code: { contains: query.search, mode: 'insensitive' } },
            { nameEn: { contains: query.search, mode: 'insensitive' } },
            { nameTh: { contains: query.search, mode: 'insensitive' } },
          ] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.campus.findMany({ where, select: this.campusSelect, orderBy: { code: 'asc' }, take: query.take, skip: query.skip }),
      this.prisma.campus.count({ where }),
    ]);
    return { total, take: query.take, skip: query.skip, items };
  }

  async createCampus(universityId: string, dto: CreateCampusDto) {
    const clash = await this.prisma.campus.findFirst({ where: { universityId, code: dto.code, deletedAt: null } });
    if (clash) throw new ConflictException(`Campus code ${dto.code} already exists`);
    return this.prisma.campus.create({
      data: {
        university: { connect: { id: universityId } },
        code: dto.code, nameEn: dto.nameEn, nameTh: dto.nameTh,
        locationType: dto.locationType, address: dto.address, city: dto.city,
      },
      select: this.campusSelect,
    });
  }

  async updateCampus(universityId: string, id: string, dto: UpdateCampusDto) {
    const campus = await this.prisma.campus.findFirst({ where: { id, universityId, deletedAt: null } });
    if (!campus) throw new NotFoundException('Campus not found');
    if (dto.code) {
      const clash = await this.prisma.campus.findFirst({ where: { universityId, code: dto.code, deletedAt: null, NOT: { id } } });
      if (clash) throw new ConflictException(`Campus code ${dto.code} already exists`);
    }
    return this.prisma.campus.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
        ...(dto.locationType !== undefined && { locationType: dto.locationType }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.city !== undefined && { city: dto.city }),
      },
      select: this.campusSelect,
    });
  }

  async removeCampus(universityId: string, id: string) {
    const campus = await this.prisma.campus.findFirst({ where: { id, universityId, deletedAt: null }, select: { id: true } });
    if (!campus) throw new NotFoundException('Campus not found');
    // A relation _count includes soft-deleted rows, which would permanently
    // block deletion the moment any building here was ever removed. Count
    // only the buildings that are actually still live.
    const buildings = await this.prisma.building.count({ where: { campusId: id, deletedAt: null } });
    if (buildings > 0) {
      throw new ConflictException(`This location has ${buildings} building(s) and cannot be deleted`);
    }
    await this.prisma.campus.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }

  // ---- buildings ------------------------------------------------------------

  private buildingSelect = {
    id: true, code: true, nameEn: true, nameTh: true, floors: true, isActive: true,
    campus: { select: { id: true, code: true, nameEn: true, locationType: true } },
    _count: { select: { rooms: true } },
  } satisfies Prisma.BuildingSelect;

  async listBuildings(universityId: string, query: QueryBuildingDto): Promise<Paginated<unknown>> {
    const where: Prisma.BuildingWhereInput = {
      deletedAt: null,
      campus: { universityId },
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(query.search
        ? { OR: [
            { code: { contains: query.search, mode: 'insensitive' } },
            { nameEn: { contains: query.search, mode: 'insensitive' } },
          ] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.building.findMany({ where, select: this.buildingSelect, orderBy: { code: 'asc' }, take: query.take, skip: query.skip }),
      this.prisma.building.count({ where }),
    ]);
    return { total, take: query.take, skip: query.skip, items };
  }

  async createBuilding(universityId: string, dto: CreateBuildingDto) {
    const campus = await this.prisma.campus.findFirst({ where: { id: dto.campusId, universityId, deletedAt: null }, select: { id: true } });
    if (!campus) throw new BadRequestException('Location does not exist in this tenant');
    const clash = await this.prisma.building.findFirst({ where: { campusId: dto.campusId, code: dto.code, deletedAt: null } });
    if (clash) throw new ConflictException(`Building code ${dto.code} already exists at this location`);
    return this.prisma.building.create({
      data: { campus: { connect: { id: dto.campusId } }, code: dto.code, nameEn: dto.nameEn, nameTh: dto.nameTh, floors: dto.floors ?? 1 },
      select: this.buildingSelect,
    });
  }

  async updateBuilding(universityId: string, id: string, dto: UpdateBuildingDto) {
    const building = await this.prisma.building.findFirst({ where: { id, deletedAt: null, campus: { universityId } } });
    if (!building) throw new NotFoundException('Building not found');
    if (dto.code) {
      const clash = await this.prisma.building.findFirst({
        where: { campusId: dto.campusId ?? building.campusId, code: dto.code, deletedAt: null, NOT: { id } },
      });
      if (clash) throw new ConflictException(`Building code ${dto.code} already exists at this location`);
    }
    return this.prisma.building.update({
      where: { id },
      data: {
        ...(dto.campusId !== undefined && { campus: { connect: { id: dto.campusId } } }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
        ...(dto.floors !== undefined && { floors: dto.floors }),
      },
      select: this.buildingSelect,
    });
  }

  async removeBuilding(universityId: string, id: string) {
    const building = await this.prisma.building.findFirst({ where: { id, deletedAt: null, campus: { universityId } }, select: { id: true } });
    if (!building) throw new NotFoundException('Building not found');
    const rooms = await this.prisma.room.count({ where: { buildingId: id, deletedAt: null } });
    if (rooms > 0) {
      throw new ConflictException(`This building has ${rooms} room(s) and cannot be deleted`);
    }
    await this.prisma.building.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }
}

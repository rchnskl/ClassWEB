import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto, QueryRoomDto } from './dto/room.dto';
import { Paginated } from '../common/dto/pagination.dto';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  private select = {
    id: true, roomNumber: true, floor: true, capacity: true, equipment: true, status: true,
    building: { select: { id: true, code: true, nameEn: true, campus: { select: { code: true, nameEn: true } } } },
  } satisfies Prisma.RoomSelect;

  async list(universityId: string, query: QueryRoomDto): Promise<Paginated<unknown>> {
    const where: Prisma.RoomWhereInput = {
      deletedAt: null,
      building: { campus: { universityId } },
      ...(query.search ? { roomNumber: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.room.findMany({ where, select: this.select, orderBy: { roomNumber: 'asc' }, take: query.take, skip: query.skip }),
      this.prisma.room.count({ where }),
    ]);
    return { total, take: query.take, skip: query.skip, items };
  }

  async get(universityId: string, id: string) {
    const room = await this.prisma.room.findFirst({
      where: { id, deletedAt: null, building: { campus: { universityId } } },
      select: this.select,
    });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  async create(universityId: string, dto: CreateRoomDto) {
    const building = await this.prisma.building.findFirst({
      where: { id: dto.buildingId, campus: { universityId } },
      select: { id: true },
    });
    if (!building) throw new BadRequestException('Building does not exist in this tenant');

    const clash = await this.prisma.room.findFirst({
      where: { buildingId: dto.buildingId, roomNumber: dto.roomNumber, deletedAt: null },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`Room ${dto.roomNumber} already exists in this building`);

    return this.prisma.room.create({
      data: {
        building: { connect: { id: dto.buildingId } },
        roomNumber: dto.roomNumber,
        floor: dto.floor,
        capacity: dto.capacity ?? 40,
        equipment: dto.equipment ?? undefined,
      },
      select: this.select,
    });
  }
}

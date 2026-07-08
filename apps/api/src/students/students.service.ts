import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StudentsRepository } from './students.repository';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { QueryStudentDto } from './dto/query-student.dto';
import { Paginated } from '../common/dto/pagination.dto';

/**
 * Business rules for students: tenant integrity, unique student code, and the
 * cross-aggregate check that the target program belongs to the caller's tenant.
 */
@Injectable()
export class StudentsService {
  constructor(private readonly repo: StudentsRepository) {}

  async list(universityId: string, query: QueryStudentDto): Promise<Paginated<unknown>> {
    const { items, total } = await this.repo.findMany(universityId, query);
    return { total, take: query.take, skip: query.skip, items };
  }

  async get(universityId: string, id: string) {
    const student = await this.repo.findById(universityId, id);
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  async create(universityId: string, dto: CreateStudentDto) {
    await this.assertProgram(universityId, dto.programId);
    if (await this.repo.findByCode(universityId, dto.studentCode)) {
      throw new ConflictException(`Student code ${dto.studentCode} already exists`);
    }

    const data: Prisma.StudentCreateInput = {
      university: { connect: { id: universityId } },
      program: { connect: { id: dto.programId } },
      studentCode: dto.studentCode,
      nameEn: dto.nameEn,
      nameTh: dto.nameTh,
      nickname: dto.nickname,
      gender: dto.gender,
      status: dto.status,
      email: dto.email,
      phone: dto.phone,
      admissionYear: dto.admissionYear,
      citizenId: dto.citizenId,
      passportNo: dto.passportNo,
      birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      qrCode: `STU-${universityId.slice(-6)}-${dto.studentCode}`,
    };
    return this.repo.create(data);
  }

  async update(universityId: string, id: string, dto: UpdateStudentDto) {
    await this.get(universityId, id); // ensures existence + tenant ownership
    if (dto.programId) await this.assertProgram(universityId, dto.programId);
    if (dto.studentCode) {
      const clash = await this.repo.findByCode(universityId, dto.studentCode);
      if (clash && clash.id !== id) {
        throw new ConflictException(`Student code ${dto.studentCode} already exists`);
      }
    }

    const data: Prisma.StudentUpdateInput = {
      ...(dto.studentCode !== undefined && { studentCode: dto.studentCode }),
      ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
      ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
      ...(dto.nickname !== undefined && { nickname: dto.nickname }),
      ...(dto.gender !== undefined && { gender: dto.gender }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.admissionYear !== undefined && { admissionYear: dto.admissionYear }),
      ...(dto.citizenId !== undefined && { citizenId: dto.citizenId }),
      ...(dto.passportNo !== undefined && { passportNo: dto.passportNo }),
      ...(dto.birthDate !== undefined && { birthDate: dto.birthDate ? new Date(dto.birthDate) : null }),
      ...(dto.programId !== undefined && { program: { connect: { id: dto.programId } } }),
    };
    return this.repo.update(id, data);
  }

  async remove(universityId: string, id: string) {
    await this.get(universityId, id);
    await this.repo.softDelete(id);
    return { id, deleted: true };
  }

  private async assertProgram(universityId: string, programId: string) {
    const program = await this.repo.programInTenant(universityId, programId);
    if (!program) throw new BadRequestException('Program does not exist in this tenant');
  }
}

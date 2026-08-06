import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StudentsRepository } from './students.repository';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { LookupStudentDto, QueryStudentDto } from './dto/query-student.dto';
import { PromoteYearDto } from './dto/promote-year.dto';
import { Paginated } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';

/**
 * Business rules for students: tenant integrity, unique student code, and the
 * cross-aggregate check that the target program belongs to the caller's tenant.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly repo: StudentsRepository,
    private readonly lecturerScope: LecturerScopeService,
  ) {}

  /** Non-admins only ever see students enrolled in a section they teach; resolves to `undefined` (no restriction) for admins. */
  private async scopedSectionIds(user: AuthenticatedUser): Promise<string[] | undefined> {
    if (this.lecturerScope.isAdmin(user)) return undefined;
    const me = await this.lecturerScope.myLecturerId(user);
    return me ? await this.lecturerScope.sectionIdsFor(me) : [];
  }

  async list(user: AuthenticatedUser, query: QueryStudentDto): Promise<Paginated<unknown>> {
    const sectionIds = await this.scopedSectionIds(user);
    const { items, total } = await this.repo.findMany(user.universityId, query, sectionIds);
    return { total, take: query.take, skip: query.skip, items };
  }

  async get(user: AuthenticatedUser, id: string) {
    const sectionIds = await this.scopedSectionIds(user);
    const student = await this.repo.findById(user.universityId, id, sectionIds);
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  /**
   * Central-roster search for building sections and groups. Unlike `list`,
   * this is intentionally NOT restricted to the caller's own sections — a
   * lecturer has to be able to find a student before they can add them. The
   * trade-off is paid for by the narrow projection (identifying fields only)
   * and by requiring a filter, so it can never be used to dump the roster.
   */
  lookup(user: AuthenticatedUser, query: LookupStudentDto) {
    const q = query.q?.trim();
    if ((!q || q.length < 2) && query.yearLevel === undefined && !query.programId) {
      throw new BadRequestException('Provide a search term of at least 2 characters, a year level, or a program');
    }
    return this.repo.lookup(user.universityId, { ...query, q: q || undefined });
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
      yearLevel: dto.yearLevel,
      citizenId: dto.citizenId,
      passportNo: dto.passportNo,
      birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      qrCode: `STU-${universityId.slice(-6)}-${dto.studentCode}`,
    };
    return this.repo.create(data);
  }

  async update(universityId: string, id: string, dto: UpdateStudentDto) {
    await this.assertExists(universityId, id); // ensures existence + tenant ownership
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
      ...(dto.yearLevel !== undefined && { yearLevel: dto.yearLevel }),
      ...(dto.citizenId !== undefined && { citizenId: dto.citizenId }),
      ...(dto.passportNo !== undefined && { passportNo: dto.passportNo }),
      ...(dto.birthDate !== undefined && { birthDate: dto.birthDate ? new Date(dto.birthDate) : null }),
      ...(dto.programId !== undefined && { program: { connect: { id: dto.programId } } }),
    };
    return this.repo.update(id, data);
  }

  async remove(universityId: string, id: string) {
    await this.assertExists(universityId, id);
    await this.repo.softDelete(id);
    return { id, deleted: true };
  }

  /**
   * Advance a whole cohort by one year at the roll-over of the academic year.
   *
   * Only STUDYING students move: someone on leave or suspended has not
   * completed the year, and silently promoting them would put them in the
   * wrong clinical placement. Students already at the final year graduate
   * instead of advancing past the end of the curriculum. Defaults to a dry
   * run so the numbers can be checked before anything is written.
   */
  async promoteYear(user: AuthenticatedUser, dto: PromoteYearDto) {
    if (!this.lecturerScope.isAdmin(user)) {
      throw new ForbiddenException('Only an administrator can promote a cohort');
    }
    if (dto.fromYear > dto.finalYear) {
      throw new BadRequestException('fromYear cannot be beyond the final year of the curriculum');
    }

    const where: Prisma.StudentWhereInput = {
      universityId: user.universityId,
      deletedAt: null,
      yearLevel: dto.fromYear,
      status: 'STUDYING',
      ...(dto.programId ? { programId: dto.programId } : {}),
    };
    const [affected, held] = await Promise.all([
      this.repo.countBy(where),
      this.repo.countBy({ ...where, status: { in: ['ON_LEAVE', 'SUSPENDED'] } as never }),
    ]);
    const graduating = dto.fromYear === dto.finalYear;

    if (!dto.commit) {
      return {
        committed: false, fromYear: dto.fromYear, toYear: graduating ? null : dto.fromYear + 1,
        graduating, affected, heldBack: held,
      };
    }

    await this.repo.promote(where, graduating ? null : dto.fromYear + 1, graduating);
    await this.repo.audit({
      universityId: user.universityId, userId: user.id,
      metadata: { action: 'promoteYear', fromYear: dto.fromYear, finalYear: dto.finalYear, programId: dto.programId ?? null, affected, graduating },
    });
    return {
      committed: true, fromYear: dto.fromYear, toYear: graduating ? null : dto.fromYear + 1,
      graduating, affected, heldBack: held,
    };
  }

  /** Admin-only paths (create/update/delete): existence + tenant ownership, no lecturer-section scoping. */
  private async assertExists(universityId: string, id: string) {
    const student = await this.repo.findById(universityId, id);
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private async assertProgram(universityId: string, programId: string) {
    const program = await this.repo.programInTenant(universityId, programId);
    if (!program) throw new BadRequestException('Program does not exist in this tenant');
  }
}

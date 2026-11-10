import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';
import { CreateCaseDto, CreateDailyNoteDto, UpdateCaseDto } from './dto/cases.dto';

const caseSelect = {
  id: true, bed: true, hn: true, patientName: true, patientAge: true, diagnosis: true, note: true,
  createdAt: true, updatedAt: true,
  students: { select: { student: { select: { id: true, studentCode: true, nameEn: true, nameTh: true } } } },
} as const;

/**
 * Daily clinical practice: the patient case each student (usually a pair)
 * takes on a practice day, and the lecturer's notes on each student that day.
 *
 * Patient details (bed, HN, name, age) are sensitive. Only lecturers who
 * teach or manage the section can see or change them, and every change is
 * written to the audit log — without the patient details themselves.
 * Daily notes are ordinary student notes tied to the day: append-only and
 * stamped with the recorder's name, like every other student note.
 */
@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lecturerScope: LecturerScopeService,
  ) {}

  private async session(user: AuthenticatedUser, classSessionId: string) {
    const session = await this.prisma.classSession.findFirst({
      where: { id: classSessionId, section: { universityId: user.universityId, deletedAt: null } },
      select: { id: true, sectionId: true, sessionDate: true, startTime: true, endTime: true, topic: true },
    });
    if (!session) throw new NotFoundException('Practice day not found');
    await this.lecturerScope.assertTeachesOrManages(user, session.sectionId);
    return session;
  }

  /** Every student must be enrolled in the day's section. */
  private async assertEnrolled(sectionId: string, studentIds: string[]) {
    const unique = [...new Set(studentIds)];
    const enrolled = await this.prisma.enrollment.count({ where: { sectionId, studentId: { in: unique }, status: 'ENROLLED' } });
    if (enrolled !== unique.length) throw new BadRequestException('Every student must be enrolled in this section');
    return unique;
  }

  private async authorName(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, lecturer: { select: { nameEn: true } }, student: { select: { nameEn: true } } },
    });
    return u?.lecturer?.nameEn ?? u?.student?.nameEn ?? u?.email ?? 'Unknown';
  }

  private audit(user: AuthenticatedUser, action: AuditAction, entityType: string, entityId: string, metadata: object) {
    return this.prisma.auditLog.create({ data: { universityId: user.universityId, userId: user.id, action, entityType, entityId, metadata } });
  }

  /** The day's cases, and the section roster with each student's notes for that day. */
  async day(user: AuthenticatedUser, classSessionId: string) {
    const session = await this.session(user, classSessionId);
    const [cases, enrollments, notes] = await Promise.all([
      this.prisma.patientCase.findMany({ where: { classSessionId }, select: caseSelect, orderBy: [{ bed: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.enrollment.findMany({
        where: { sectionId: session.sectionId, status: 'ENROLLED' },
        select: { student: { select: { id: true, studentCode: true, nameEn: true, nameTh: true } } },
        orderBy: { student: { studentCode: 'asc' } },
      }),
      this.prisma.studentNote.findMany({
        where: { classSessionId, deletedAt: null },
        select: { id: true, studentId: true, content: true, authorName: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      session,
      cases: cases.map(({ students, ...c }) => ({ ...c, students: students.map((s) => s.student) })),
      roster: enrollments.map((e) => ({ ...e.student, notes: notes.filter((n) => n.studentId === e.student.id) })),
    };
  }

  async create(user: AuthenticatedUser, dto: CreateCaseDto) {
    const session = await this.session(user, dto.classSessionId);
    const studentIds = await this.assertEnrolled(session.sectionId, dto.studentIds);
    const { classSessionId, studentIds: _ignored, ...fields } = dto;
    void _ignored;
    const created = await this.prisma.patientCase.create({
      data: {
        universityId: user.universityId, classSessionId, createdById: user.id, ...fields,
        students: { create: studentIds.map((studentId) => ({ studentId })) },
      },
      select: caseSelect,
    });
    await this.audit(user, AuditAction.CREATE, 'PatientCase', created.id, { classSessionId, studentIds });
    return { ...created, students: created.students.map((s) => s.student) };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateCaseDto) {
    const existing = await this.prisma.patientCase.findFirst({ where: { id, universityId: user.universityId }, select: { classSessionId: true } });
    if (!existing) throw new NotFoundException('Case not found');
    const session = await this.session(user, existing.classSessionId);
    const studentIds = dto.studentIds ? await this.assertEnrolled(session.sectionId, dto.studentIds) : undefined;
    const { studentIds: _ignored, ...fields } = dto;
    void _ignored;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (studentIds) {
        await tx.patientCaseStudent.deleteMany({ where: { caseId: id } });
        await tx.patientCaseStudent.createMany({ data: studentIds.map((studentId) => ({ caseId: id, studentId })) });
      }
      return tx.patientCase.update({ where: { id }, data: fields, select: caseSelect });
    });
    await this.audit(user, AuditAction.UPDATE, 'PatientCase', id, { fields: Object.keys(fields), ...(studentIds && { studentIds }) });
    return { ...updated, students: updated.students.map((s) => s.student) };
  }

  async remove(user: AuthenticatedUser, id: string) {
    const existing = await this.prisma.patientCase.findFirst({ where: { id, universityId: user.universityId }, select: { classSessionId: true } });
    if (!existing) throw new NotFoundException('Case not found');
    await this.session(user, existing.classSessionId);
    await this.prisma.patientCase.delete({ where: { id } });
    await this.audit(user, AuditAction.DELETE, 'PatientCase', id, { classSessionId: existing.classSessionId });
    return { deleted: true };
  }

  async addNote(user: AuthenticatedUser, dto: CreateDailyNoteDto) {
    const session = await this.session(user, dto.classSessionId);
    await this.assertEnrolled(session.sectionId, [dto.studentId]);
    const note = await this.prisma.studentNote.create({
      data: {
        universityId: user.universityId, studentId: dto.studentId, classSessionId: dto.classSessionId,
        category: 'GENERAL', content: dto.content.trim(), authorUserId: user.id, authorName: await this.authorName(user.id),
      },
      select: { id: true, studentId: true, content: true, authorName: true, createdAt: true },
    });
    await this.audit(user, AuditAction.CREATE, 'StudentNote', note.id, { studentId: dto.studentId, classSessionId: dto.classSessionId });
    return note;
  }
}

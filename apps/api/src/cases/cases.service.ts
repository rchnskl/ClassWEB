import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';
import { CarryForwardDto, CreateCaseDto, CreateDailyNoteDto, DischargeCaseDto, UpdateCaseDto, UpdateDailyNoteDto } from './dto/cases.dto';

const noteSelect = { id: true, studentId: true, content: true, authorName: true, authorUserId: true, createdAt: true, metadata: true } as const;

const caseSelect = {
  id: true, bed: true, hn: true, patientName: true, patientAge: true, diagnosis: true, note: true,
  dischargedAt: true, continuedFromId: true,
  continuedFrom: { select: { classSession: { select: { sessionDate: true } } } },
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
 * Daily notes are ordinary student notes tied to the day, stamped with the
 * recorder's name. The recorder (or an admin) can correct or remove one; the
 * earlier wording is kept in the note's history and the audit log, so the
 * record stays evidence.
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

  private shape<T extends { students: { student: unknown }[]; continuedFrom: { classSession: { sessionDate: Date } } | null }>(c: T) {
    const { students, continuedFrom, ...rest } = c;
    return { ...rest, continuedFromDate: continuedFrom?.classSession.sessionDate ?? null, students: students.map((s) => s.student) };
  }

  /**
   * The most recent earlier practice day of the section that has cases, and
   * those of its cases that could carry on into `session`: the patient did
   * not go home, and the case hasn't been carried into this day already.
   */
  private async previousDay(sectionId: string, session: { id: string; sessionDate: Date }) {
    const prev = await this.prisma.classSession.findFirst({
      where: { sectionId, sessionDate: { lt: session.sessionDate }, patientCases: { some: {} } },
      select: { id: true, sessionDate: true },
      orderBy: { sessionDate: 'desc' },
    });
    if (!prev) return null;
    const [cases, carried] = await Promise.all([
      this.prisma.patientCase.findMany({ where: { classSessionId: prev.id, dischargedAt: null }, select: caseSelect, orderBy: [{ bed: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.patientCase.findMany({ where: { classSessionId: session.id, continuedFromId: { not: null } }, select: { continuedFromId: true } }),
    ]);
    const already = new Set(carried.map((c) => c.continuedFromId));
    return { session: prev, cases: cases.filter((c) => !already.has(c.id)).map((c) => this.shape(c)) };
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
        select: noteSelect,
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      session,
      cases: cases.map((c) => this.shape(c)),
      roster: enrollments.map((e) => ({ ...e.student, notes: notes.filter((n) => n.studentId === e.student.id).map((n) => this.shapeNote(n)) })),
      // Cases from the previous practice day that can carry on into this one.
      previous: await this.previousDay(session.sectionId, session),
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
    return this.shape(created);
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
    return this.shape(updated);
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
      select: noteSelect,
    });
    await this.audit(user, AuditAction.CREATE, 'StudentNote', note.id, { studentId: dto.studentId, classSessionId: dto.classSessionId });
    return this.shapeNote(note);
  }

  private shapeNote(n: { metadata: Prisma.JsonValue } & Record<string, unknown>) {
    const { metadata, ...rest } = n;
    const edits = (metadata as { edits?: { at: string }[] } | null)?.edits ?? [];
    return { ...rest, editedAt: edits.length ? edits[edits.length - 1].at : null, editCount: edits.length };
  }

  /** A daily note the caller may change: their own (or any, for an admin), in a section they teach. */
  private async ownNote(user: AuthenticatedUser, id: string) {
    const note = await this.prisma.studentNote.findFirst({
      where: { id, universityId: user.universityId, deletedAt: null, classSessionId: { not: null } },
      select: { id: true, content: true, authorUserId: true, classSessionId: true, studentId: true, metadata: true },
    });
    if (!note) throw new NotFoundException('Note not found');
    await this.session(user, note.classSessionId!);
    if (note.authorUserId !== user.id && !this.lecturerScope.isAdmin(user)) {
      throw new ForbiddenException('Only the person who wrote this note can change it');
    }
    return note;
  }

  /** Correct a daily note; the previous wording is kept in its history. */
  async updateNote(user: AuthenticatedUser, id: string, dto: UpdateDailyNoteDto) {
    const note = await this.ownNote(user, id);
    const content = dto.content.trim();
    if (content === note.content) {
      return this.shapeNote(await this.prisma.studentNote.findUniqueOrThrow({ where: { id }, select: noteSelect }));
    }
    const meta = (note.metadata as { edits?: unknown[] } | null) ?? {};
    const edits = [...(meta.edits ?? []), { at: new Date().toISOString(), by: user.id, previous: note.content }];
    const updated = await this.prisma.studentNote.update({
      where: { id }, data: { content, metadata: { ...meta, edits } as Prisma.InputJsonValue }, select: noteSelect,
    });
    await this.audit(user, AuditAction.UPDATE, 'StudentNote', id, { studentId: note.studentId, classSessionId: note.classSessionId, previous: note.content });
    return this.shapeNote(updated);
  }

  /** Remove a daily note (soft delete — the text stays in the record and audit log). */
  async deleteNote(user: AuthenticatedUser, id: string) {
    const note = await this.ownNote(user, id);
    await this.prisma.studentNote.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit(user, AuditAction.DELETE, 'StudentNote', id, { studentId: note.studentId, classSessionId: note.classSessionId, content: note.content });
    return { deleted: true };
  }

  /**
   * Carry cases from an earlier practice day into this one — the same
   * patient and the same students (those still enrolled), linked back so the
   * patient's course can be followed day to day.
   */
  async carryForward(user: AuthenticatedUser, dto: CarryForwardDto) {
    const session = await this.session(user, dto.classSessionId);
    const sources = await this.prisma.patientCase.findMany({
      where: { id: { in: dto.caseIds }, universityId: user.universityId, classSession: { sectionId: session.sectionId, sessionDate: { lt: session.sessionDate } } },
      select: { id: true, bed: true, hn: true, patientName: true, patientAge: true, diagnosis: true, note: true, dischargedAt: true, students: { select: { studentId: true } } },
    });
    if (sources.length !== new Set(dto.caseIds).size) throw new BadRequestException('Only cases from an earlier practice day of this section can be carried forward');
    if (sources.some((c) => c.dischargedAt)) throw new BadRequestException('A patient who went home cannot be carried forward');
    const already = new Set((await this.prisma.patientCase.findMany({
      where: { classSessionId: session.id, continuedFromId: { in: dto.caseIds } }, select: { continuedFromId: true },
    })).map((c) => c.continuedFromId));
    const enrolled = new Set((await this.prisma.enrollment.findMany({
      where: { sectionId: session.sectionId, status: 'ENROLLED' }, select: { studentId: true },
    })).map((e) => e.studentId));

    const created = [];
    for (const src of sources.filter((c) => !already.has(c.id))) {
      const studentIds = src.students.map((m) => m.studentId).filter((id) => enrolled.has(id));
      const c = await this.prisma.patientCase.create({
        data: {
          universityId: user.universityId, classSessionId: session.id, createdById: user.id, continuedFromId: src.id,
          bed: src.bed, hn: src.hn, patientName: src.patientName, patientAge: src.patientAge, diagnosis: src.diagnosis, note: src.note,
          students: { create: studentIds.map((studentId) => ({ studentId })) },
        },
        select: caseSelect,
      });
      await this.audit(user, AuditAction.CREATE, 'PatientCase', c.id, { classSessionId: session.id, continuedFromId: src.id, studentIds });
      created.push(this.shape(c));
    }
    return { created: created.length, cases: created };
  }

  /** The patient went home (or back): mark or clear the case's discharge. */
  async discharge(user: AuthenticatedUser, id: string, dto: DischargeCaseDto) {
    const existing = await this.prisma.patientCase.findFirst({ where: { id, universityId: user.universityId }, select: { classSessionId: true } });
    if (!existing) throw new NotFoundException('Case not found');
    await this.session(user, existing.classSessionId);
    const updated = await this.prisma.patientCase.update({
      where: { id }, data: { dischargedAt: dto.discharged ? new Date() : null }, select: caseSelect,
    });
    await this.audit(user, AuditAction.UPDATE, 'PatientCase', id, { discharged: dto.discharged });
    return this.shape(updated);
  }
}

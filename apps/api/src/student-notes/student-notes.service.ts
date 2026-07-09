import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentNoteDto } from './dto/student-note.dto';

/**
 * Append-only student behaviour / daily notes kept as evidence. Each note is
 * stamped with an immutable snapshot of the recorder's name and the write time;
 * there is no update path by design.
 */
@Injectable()
export class StudentNotesService {
  constructor(private readonly prisma: PrismaService) {}

  private select = {
    id: true, category: true, content: true, flagged: true,
    authorName: true, authorUserId: true, createdAt: true,
  };

  private async assertStudent(universityId: string, studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, universityId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new BadRequestException('Student does not exist in this tenant');
  }

  async list(universityId: string, studentId: string) {
    await this.assertStudent(universityId, studentId);
    const items = await this.prisma.studentNote.findMany({
      where: { studentId, universityId, deletedAt: null },
      select: this.select,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { total: items.length, items };
  }

  async create(universityId: string, studentId: string, authorUserId: string, dto: CreateStudentNoteDto) {
    await this.assertStudent(universityId, studentId);

    // Resolve a human-readable recorder name to stamp onto the note.
    const author = await this.prisma.user.findUnique({
      where: { id: authorUserId },
      select: {
        email: true,
        lecturer: { select: { nameEn: true } },
        student: { select: { nameEn: true } },
      },
    });
    const authorName = author?.lecturer?.nameEn ?? author?.student?.nameEn ?? author?.email ?? 'Unknown';

    const note = await this.prisma.studentNote.create({
      data: {
        university: { connect: { id: universityId } },
        student: { connect: { id: studentId } },
        category: dto.category,
        content: dto.content,
        flagged: dto.flagged ?? false,
        authorUserId,
        authorName,
      },
      select: this.select,
    });

    await this.prisma.auditLog.create({
      data: {
        universityId,
        userId: authorUserId,
        action: AuditAction.CREATE,
        entityType: 'StudentNote',
        entityId: note.id,
        metadata: { studentId, category: dto.category },
      },
    });
    return note;
  }
}

// Imports the grading scheme actually in use for NUS2202 — the seven weighted
// components of the final grade, plus the six Mid-term laboratory procedure
// checklists that make up the 7% "Laboratory for Mid-term Examination".
//
// See scripts/data/grading-scheme.mjs for the data and its provenance
// (transcribed from the faculty's syllabus and the .doc checklist forms).
//
// Shape of what it creates:
//   7 Rubrics, one per score component, each attached to NUS2202 via
//   SubjectRubric at its syllabus weight (25/30/7/8/8/10/12 = 100).
//     * six of them hold a single item whose maxRating is the component's
//       full mark, so the lecturer types the raw mark straight in;
//     * LAB_MIDTERM instead holds the seven checklist sections (172 steps),
//       with the form's starred must-pass steps flagged isCritical.
//
// Attaching explicit SubjectRubric rows switches NUS2202 from "implicitly
// uses every rubric in the catalogue at its default weight" to "uses exactly
// these seven" — which is the point: the 13 clinical checklists stay in the
// catalogue as assessment tools but stop silently counting toward the grade.
//
// Fully idempotent: every write is an upsert on a natural key, and a rubric's
// sections/items are rebuilt from the data file each run, so re-running after
// a wording fix updates rather than duplicates.
//
// Run:  node scripts/import-grading-scheme.mjs [--commit]
import { PrismaClient } from '@prisma/client';
import { SCORE_COMPONENTS, LAB_MIDTERM_SECTIONS, LAB_MIDTERM_CODE } from './data/grading-scheme.mjs';

const prisma = new PrismaClient();
const COMMIT = process.argv.includes('--commit');
const SUBJECT_CODE = 'NUS2202';

async function main() {
  const university = await prisma.university.findFirst({ where: { code: 'AU' }, select: { id: true } });
  if (!university) throw new Error('University AU not found — run the seed first');

  const subject = await prisma.subject.findFirst({
    where: { code: SUBJECT_CODE, deletedAt: null, program: { faculty: { universityId: university.id } } },
    select: { id: true, code: true },
  });
  if (!subject) throw new Error(`Subject ${SUBJECT_CODE} not found`);

  const totalWeight = SCORE_COMPONENTS.reduce((a, c) => a + c.weightPercent, 0);
  if (totalWeight !== 100) throw new Error(`Component weights sum to ${totalWeight}, expected 100`);

  console.log(`Subject ${subject.code}`);
  console.log(`Components: ${SCORE_COMPONENTS.length} (weights sum ${totalWeight})`);
  console.log(`Lab mid-term checklist: ${LAB_MIDTERM_SECTIONS.length} sections, ${LAB_MIDTERM_SECTIONS.reduce((a, s) => a + s.items.length, 0)} steps`);

  if (!COMMIT) {
    console.log('\nDry run — nothing written. Re-run with --commit to apply.');
    return;
  }

  for (const c of SCORE_COMPONENTS) {
    const existing = await prisma.rubric.findFirst({
      where: { universityId: university.id, code: c.code },
      select: { id: true },
    });

    const rubric = existing
      ? await prisma.rubric.update({
          where: { id: existing.id },
          data: { nameEn: c.nameEn, nameTh: c.nameTh, weightPercent: c.weightPercent, order: c.order, isActive: true, deletedAt: null },
          select: { id: true },
        })
      : await prisma.rubric.create({
          data: {
            university: { connect: { id: university.id } },
            code: c.code, nameEn: c.nameEn, nameTh: c.nameTh,
            weightPercent: c.weightPercent, order: c.order,
          },
          select: { id: true },
        });

    // Rebuild the body from the data file so a wording fix propagates.
    // Cascades clear the items with their sections.
    await prisma.rubricSection.deleteMany({ where: { rubricId: rubric.id } });

    if (c.code === LAB_MIDTERM_CODE) {
      for (const [i, s] of LAB_MIDTERM_SECTIONS.entries()) {
        await prisma.rubricSection.create({
          data: {
            rubricId: rubric.id, nameEn: s.nameEn, nameTh: s.nameTh,
            weightPercent: s.weightPercent, order: i,
            items: {
              create: s.items.map((it, j) => ({
                textEn: it.en, weightPercent: s.itemWeightPercent,
                maxRating: 5, order: j, isCritical: Boolean(it.isCritical),
              })),
            },
          },
        });
      }
    } else {
      // A plain score component: one section, one item carrying the raw mark.
      await prisma.rubricSection.create({
        data: {
          rubricId: rubric.id, nameEn: c.nameEn, nameTh: c.nameTh,
          weightPercent: 100, order: 0,
          items: {
            create: [{
              textEn: `${c.nameEn} (out of ${c.weightPercent})`,
              textTh: `${c.nameTh} (เต็ม ${c.weightPercent} คะแนน)`,
              weightPercent: 100, maxRating: c.weightPercent, order: 0, isCritical: false,
            }],
          },
        },
      });
    }

    await prisma.subjectRubric.upsert({
      where: { subjectId_rubricId: { subjectId: subject.id, rubricId: rubric.id } },
      update: { weightPercent: c.weightPercent, isActive: true, order: c.order },
      create: { subjectId: subject.id, rubricId: rubric.id, weightPercent: c.weightPercent, isActive: true, order: c.order },
    });

    console.log(`  ✓ ${c.code.padEnd(18)} ${String(c.weightPercent).padStart(3)}%`);
  }

  // Any rubric previously attached to this subject that is not part of the
  // scheme is deactivated rather than deleted — it stays available as an
  // assessment tool without counting toward the grade.
  const keep = new Set(SCORE_COMPONENTS.map((c) => c.code));
  const stale = await prisma.subjectRubric.findMany({
    where: { subjectId: subject.id, isActive: true, rubric: { code: { notIn: [...keep] } } },
    select: { id: true, rubric: { select: { code: true, nameEn: true } } },
  });
  if (stale.length) {
    await prisma.subjectRubric.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { isActive: false } });
    console.log(`\nDeactivated ${stale.length} rubric(s) no longer part of the scheme:`);
    stale.forEach((s) => console.log(`  - ${s.rubric.code ?? s.rubric.nameEn}`));
  }

  const check = await prisma.subjectRubric.aggregate({
    where: { subjectId: subject.id, isActive: true },
    _sum: { weightPercent: true },
  });
  console.log(`\nActive weight for ${subject.code}: ${check._sum.weightPercent}%`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

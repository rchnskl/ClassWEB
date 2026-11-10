import { writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { ReportsService } from './reports.service';
import { AuthenticatedUser } from '../common/authenticated-user';

/**
 * Smoke coverage for the individual grade report. The three formats are
 * generated from one fixture and share a gatherer, so a missing field or a
 * bad table layout shows up here rather than in a lecturer's hands. The PDF
 * is only checked for "renders, and is a real PDF" — pdfkit output isn't
 * meaningfully assertable — while CSV/XLSX are checked for the actual marks.
 */
describe('ReportsService — individual grade report', () => {
  const user = { id: 'u1', universityId: 'uni1', roles: ['ADMIN'] } as unknown as AuthenticatedUser;

  // One multi-procedure checklist (the student drew one of two procedures,
  // and failed a must-pass step) plus one score component marked out of 25.
  const rubrics = [
    {
      id: 'r-lab', code: 'LAB', nameEn: 'Lab mid-term', nameTh: 'ปฏิบัติกลางภาค', weightPercent: 40,
      sections: [
        {
          id: 's-hand', nameEn: 'Hand hygiene', nameTh: 'การล้างมือ', weightPercent: 50,
          items: [
            { id: 'i1', textEn: 'Verifies patient identity', textTh: 'ตรวจสอบตัวผู้ป่วย', maxRating: 5, weightPercent: 50, isCritical: true },
            { id: 'i2', textEn: 'Washes for 20 seconds', textTh: 'ล้างมือ 20 วินาที', maxRating: 5, weightPercent: 50, isCritical: false },
          ],
        },
        {
          id: 's-vitals', nameEn: 'Vital signs', nameTh: 'สัญญาณชีพ', weightPercent: 50,
          items: [{ id: 'i3', textEn: 'Measures blood pressure', textTh: 'วัดความดัน', maxRating: 5, weightPercent: 100, isCritical: false }],
        },
      ],
    },
    {
      id: 'r-mid', code: 'MID', nameEn: 'Midterm exam', nameTh: 'สอบกลางภาค', weightPercent: 60,
      sections: [{
        id: 's-mid', nameEn: 'Midterm exam', nameTh: 'สอบกลางภาค', weightPercent: 100,
        items: [{ id: 'i4', textEn: 'Written paper', textTh: 'ข้อเขียน', maxRating: 25, weightPercent: 100, isCritical: false }],
      }],
    },
  ];

  // The student drew Hand hygiene only, and sat the midterm.
  const evaluations = [
    { rubricId: 'r-lab', scores: [{ rubricItemId: 'i1', rating: 3, passed: false }, { rubricItemId: 'i2', rating: 4, passed: null }] },
    { rubricId: 'r-mid', scores: [{ rubricItemId: 'i4', rating: 21.5, passed: null }] },
  ];

  const summary = {
    student: { studentCode: '6512345', nameEn: 'Somchai Jaidee', nameTh: 'สมชาย ใจดี', program: { code: 'BNS' } },
    sectionId: 'sec1',
    rubrics: [
      { rubricId: 'r-lab', nameEn: 'Lab mid-term', nameTh: 'ปฏิบัติกลางภาค', weightPercent: 40, scorePercent: 0, graded: true, criticalFailed: true, contribution: 0 },
      { rubricId: 'r-mid', nameEn: 'Midterm exam', nameTh: 'สอบกลางภาค', weightPercent: 60, scorePercent: 86, graded: true, criticalFailed: false, contribution: 51.6 },
    ],
    total: 51.6, gradedWeight: 100, isComplete: true,
    grade: { grade: 'D+', gpa: 1.5, label: 'Poor' },
  };

  const prisma = {
    university: { findUnique: jest.fn().mockResolvedValue({ nameEn: 'Assumption University', nameTh: 'มหาวิทยาลัยอัสสัมชัญ' }) },
    faculty: { findFirst: jest.fn().mockResolvedValue({ nameEn: 'Faculty of Nursing', nameTh: 'คณะพยาบาลศาสตร์' }) },
    section: { findFirst: jest.fn().mockResolvedValue({ subjectId: 'subj1', sectionNo: '01', subject: { code: 'NUS2202', nameEn: 'Adult Nursing', nameTh: 'การพยาบาลผู้ใหญ่' } }) },
    evaluation: { findMany: jest.fn().mockResolvedValue(evaluations) },
    report: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    // One practice day: present, a paired case, two notes.
    classSession: { findMany: jest.fn().mockResolvedValue([{ id: 'cs1', sessionDate: new Date('2026-11-10T00:00:00Z'), startTime: '07:00', endTime: '16:00', topic: 'Clinical practice — Ward 9/4' }]) },
    attendanceRecord: { findMany: jest.fn().mockResolvedValue([{ classSessionId: 'cs1', status: 'PRESENT', minutesLate: 0 }]) },
    patientCase: { findMany: jest.fn().mockResolvedValue([{
      classSessionId: 'cs1', bed: '12', hn: '6512399', patientName: 'ด.ช. ธนากร มีสุข', patientAge: '2 ปี 3 เดือน', diagnosis: 'Pneumonia',
      students: [{ student: { id: 'stu1', nameEn: 'Somchai Jaidee', nameTh: 'สมชาย ใจดี' } }, { student: { id: 'stu2', nameEn: 'Suda Rakdee', nameTh: null } }],
    }]) },
    studentNote: { findMany: jest.fn().mockResolvedValue([
      { classSessionId: 'cs1', content: 'Well prepared; explained the drugs clearly', authorName: 'A. Rachanon Sakol', createdAt: new Date('2026-11-10T08:30:00Z') },
    ]) },
  };
  const assessment = {
    studentSummary: jest.fn().mockResolvedValue(summary),
    activeRubricsForSubject: jest.fn().mockResolvedValue(rubrics),
  };
  const settings = { getMap: jest.fn().mockResolvedValue({ 'pdf.header': '', 'pdf.footer': 'ClassWeb' }) };
  const service = new ReportsService(prisma as any, {} as any, assessment as any, settings as any);

  it('renders a PDF with the item breakdown', async () => {
    const { buffer, reportNumber } = await service.studentGradePdf(user, 'stu1', 'sec1');
    expect(reportNumber).toMatch(/^RPT-\d{8}-[0-9A-F]{6}$/);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(5000);
    // The generated file is stored for the QR verify link.
    expect(prisma.report.update).toHaveBeenCalled();
  });

  it('puts marks, not just percentages, in the CSV', async () => {
    const { content } = await service.studentGradeCsv(user, 'stu1', 'sec1');
    const lines = content.split('\n');
    // Raw marks: the drawn procedure (3 + 4 of 10) plus the midterm (21.5 of 25).
    expect(lines).toContain('Raw marks,28.5/35');
    expect(lines.some((l) => l.startsWith('Lab mid-term,7,10,40,0,Hand hygiene,Yes,0'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Midterm exam,21.5,25,60,86,,Yes,51.6'))).toBe(true);
    // Item rows carry the must-pass result.
    expect(lines.some((l) => l.includes('Verifies patient identity,3,5,Yes,Failed'))).toBe(true);
    // The procedure the student never drew stays out of the sheet.
    expect(content).not.toContain('Measures blood pressure');
  });

  it('adds the day-by-day practice record, with patient details masked', async () => {
    const { content } = await service.studentGradeCsv(user, 'stu1', 'sec1');
    const day = content.split('\n').find((l) => l.startsWith('2026-11-10'));
    expect(day).toBeDefined();
    expect(day).toContain('Present');
    expect(day).toContain('Bed 12 · HN •••399 · ด.ช. ธ. ม. · age 2 ปี 3 เดือน · Dx Pneumonia');
    expect(day).toContain('Suda Rakdee'); // the partner, not the student themself
    expect(day).toContain('Well prepared; explained the drugs clearly (A. Rachanon Sakol, 15:30)');
    // The report can be opened from its public QR link: never the full name or HN.
    expect(content).not.toContain('6512399');
    expect(content).not.toContain('ธนากร');

    const { buffer } = await service.studentGradeXlsx(user, 'stu1', 'sec1');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const values = JSON.stringify(wb.getWorksheet('Daily practice')!.getSheetValues());
    expect(values).toContain('•••399');
    expect(values).not.toContain('6512399');
  });

  it('adds an item-marks sheet to the workbook', async () => {
    const { buffer } = await service.studentGradeXlsx(user, 'stu1', 'sec1');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Grades', 'Item marks', 'Daily practice']);
    const detail = wb.getWorksheet('Item marks')!;
    const rows = detail.getRows(2, detail.rowCount - 1)!.map((r) => r.values as unknown[]);
    expect(rows).toHaveLength(3); // two examined checklist steps + the midterm
    expect(rows[0]).toEqual(expect.arrayContaining(['Verifies patient identity', 3, 5, 'Yes', 'Failed']));
    expect(rows[2]).toEqual(expect.arrayContaining(['Written paper', 21.5, 25]));
  });
});

/**
 * The whole-class sheet. Its failure modes are layout ones the lecturer sees
 * on paper: a bare "0" with no marks behind it, a procedure name bleeding into
 * the row below, and a legend/signature that each broke onto a near-empty page
 * of their own.
 */
describe('ReportsService — section grade sheet', () => {
  const user = { id: 'u1', universityId: 'uni1', roles: ['ADMIN'] } as unknown as AuthenticatedUser;

  const rubrics = [
    {
      id: 'r-lab', nameEn: 'Lab mid-term', nameTh: 'การสอบกลางภาค (ภาคปฏิบัติ)', weightPercent: 15,
      sections: [
        { id: 's-1', nameEn: 'Nasogastric tube feeding', nameTh: 'การให้อาหารทางสายยางให้อาหาร', weightPercent: 50,
          items: [{ id: 'i1', textEn: 'Step 1', textTh: 'ขั้นตอนที่ 1', maxRating: 5, weightPercent: 100, isCritical: false }] },
        { id: 's-2', nameEn: 'Urinary catheterisation', nameTh: 'การสวนปัสสาวะ', weightPercent: 50,
          items: [{ id: 'i2', textEn: 'Step 1', textTh: 'ขั้นตอนที่ 1', maxRating: 5, weightPercent: 100, isCritical: false }] },
      ],
    },
    {
      id: 'r-mid', nameEn: 'Midterm exam', nameTh: 'สอบกลางภาค', weightPercent: 85,
      sections: [{ id: 's-3', nameEn: 'Midterm exam', nameTh: 'สอบกลางภาค', weightPercent: 100,
        items: [{ id: 'i3', textEn: 'Written paper', textTh: 'ข้อเขียน', maxRating: 50, weightPercent: 100, isCritical: false }] }],
    },
  ];

  const summary = {
    students: [
      { studentId: 'a', studentCode: '6512345', nameEn: 'Somchai Jaidee', nameTh: 'สมชาย ใจดี', total: 71.4, gradedWeight: 100, gradedCount: 2, hasCriticalFail: false, isComplete: true, grade: 'B', gpa: 3 },
      { studentId: 'b', studentCode: '6512346', nameEn: 'Suda Rakdee', nameTh: 'สุดา รักดี', total: 0, gradedWeight: 15, gradedCount: 1, hasCriticalFail: false, isComplete: false, grade: null, gpa: null },
    ],
  };

  // Student A: the checklist item by item, and the exam entered directly as
  // 42/50. Student B: a zero on the checklist and nothing else yet.
  const evaluations = [
    { id: 'e1', studentId: 'a', rubricId: 'r-lab', scorePercent: 80, rawScore: null, rawMax: null, scores: [{ rubricItemId: 'i1', rating: 4 }] },
    { id: 'e2', studentId: 'a', rubricId: 'r-mid', scorePercent: 84, rawScore: 42, rawMax: 50, scores: [] },
    { id: 'e3', studentId: 'b', rubricId: 'r-lab', scorePercent: 0, rawScore: null, rawMax: null, scores: [{ rubricItemId: 'i2', rating: 0 }] },
  ];

  const prisma = {
    university: { findUnique: jest.fn().mockResolvedValue({ nameEn: 'Assumption University', nameTh: 'มหาวิทยาลัยอัสสัมชัญ' }) },
    faculty: { findFirst: jest.fn().mockResolvedValue({ nameEn: 'Faculty of Nursing', nameTh: 'คณะพยาบาลศาสตร์' }) },
    section: { findFirst: jest.fn().mockResolvedValue({ subjectId: 'subj1', sectionNo: '01', subject: { code: 'NUS2202', nameEn: 'Adult Nursing', nameTh: 'การพยาบาลผู้ใหญ่' } }) },
    evaluation: { findMany: jest.fn().mockResolvedValue(evaluations) },
    report: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const assessment = {
    sectionSummary: jest.fn().mockResolvedValue(summary),
    activeRubricsForSubject: jest.fn().mockResolvedValue(rubrics),
  };
  const settings = { getMap: jest.fn().mockResolvedValue({ 'pdf.header': '', 'pdf.footer': 'ClassWeb' }) };
  const service = new ReportsService(prisma as any, {} as any, assessment as any, settings as any);

  it('fits a small class on one page', async () => {
    const { buffer } = await service.sectionGradesPdf(user, 'sec1', 'u1', 'A. Rachanon Sakol');
    if (process.env.DUMP_SECTION_PDF) writeFileSync(process.env.DUMP_SECTION_PDF, buffer);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    // Two students and two rubrics have no business spilling onto a second
    // sheet — the legend and signature used to force two.
    expect(buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).toHaveLength(1);
  });

  it('carries the marks behind each percentage into the CSV', async () => {
    const { content } = await service.sectionGradesCsv(user, 'sec1');
    const lines = content.split('\n');
    expect(lines[3]).toContain('Lab mid-term — Marks');
    expect(lines[3]).toContain('Midterm exam — Marks');
    // Directly entered exam keeps the mark as typed; the checklist sums the
    // items the student was actually examined on.
    expect(lines[4]).toContain('42/50');
    expect(lines[4]).toContain('4/5');
    // A zero is shown as a zero out of something, not a bare 0.
    expect(lines[5]).toContain('0/5');
  });
});

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

  it('adds an item-marks sheet to the workbook', async () => {
    const { buffer } = await service.studentGradeXlsx(user, 'stu1', 'sec1');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Grades', 'Item marks']);
    const detail = wb.getWorksheet('Item marks')!;
    const rows = detail.getRows(2, detail.rowCount - 1)!.map((r) => r.values as unknown[]);
    expect(rows).toHaveLength(3); // two examined checklist steps + the midterm
    expect(rows[0]).toEqual(expect.arrayContaining(['Verifies patient identity', 3, 5, 'Yes', 'Failed']));
    expect(rows[2]).toEqual(expect.arrayContaining(['Written paper', 21.5, 25]));
  });
});

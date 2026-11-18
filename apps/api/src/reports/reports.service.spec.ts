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
  const service = new ReportsService(prisma as any, {} as any, assessment as any, settings as any, {} as any);

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
  const service = new ReportsService(prisma as any, {} as any, assessment as any, settings as any, {} as any);

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

describe('ReportsService.sectionDailyPdf', () => {
  const user = { id: 'u1', universityId: 'uni1', roleCodes: ['LECTURER'] } as any;
  const marks = ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', null] as const;
  const days = Array.from({ length: 30 }, (_, i) => ({
    sessionId: `cs${i}`, date: `2026-0${8 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`, startTime: '08:00', endTime: '12:00',
    topic: i === 0 ? 'ปฐมนิเทศ' : null, upcoming: i >= 28, enrolled: 3, present: 2, late: 0, absent: 1, leave: 0, unrecorded: 0, rate: 66.7,
    recordedBy: i % 3 === 0 ? [{ kind: 'USER', userId: 'u1', email: 'somchai@nursing.au.edu', nameEn: 'Dr. Somchai', nameTh: 'อ.สมชาย', count: 3 }]
      : [{ kind: 'SELF', userId: null, email: null, nameEn: null, nameTh: null, count: 2 }, { kind: 'USER', userId: 'u1', email: 'somchai@nursing.au.edu', nameEn: 'Dr. Somchai', nameTh: 'อ.สมชาย', count: 1 }],
  }));
  const students = ['สมชาย ใจดี', 'สุดา รักดี', null].map((nameTh, k) => ({
    studentId: `s${k}`, studentCode: `651234${k}`, nameEn: `Student ${k}`, nameTh,
    marks: days.map((_, i) => (i >= 28 ? null : marks[(i + k) % marks.length])), attended: 12, absent: 6, late: 6, rate: 75 + k * 10,
  }));
  const daily = {
    section: { id: 'sec1', sectionNo: '01', subject: { code: 'NUS2202', nameEn: 'Adult Nursing', nameTh: 'การพยาบาลผู้ใหญ่' },
      semester: { nameEn: '1/2026', nameTh: '1/2569' }, lecturer: { nameEn: 'A. Rachanon', nameTh: 'อ.รชานนท์' }, room: { roomNumber: 'N-301' } },
    days, students, totals: { classDays: 30, daysHeld: 28, averageRate: 76.4, studentsBelow80: 1 },
  };
  const prisma = {
    university: { findUnique: jest.fn().mockResolvedValue({ nameEn: 'Assumption University', nameTh: 'มหาวิทยาลัยอัสสัมชัญ' }) },
    faculty: { findFirst: jest.fn().mockResolvedValue({ nameEn: 'Faculty of Nursing', nameTh: 'คณะพยาบาลศาสตร์' }) },
    report: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const settings = { getMap: jest.fn().mockResolvedValue({ 'pdf.header': '', 'pdf.footer': 'ClassWeb' }) };
  const attendance = { sectionDaily: jest.fn().mockResolvedValue(daily) };
  const service = new ReportsService(prisma as any, {} as any, {} as any, settings as any, attendance as any);

  it('renders a registered PDF of the section overview', async () => {
    const { buffer, reportNumber } = await service.sectionDailyPdf(user, 'sec1', 'u1', 'อ.รชานนท์');
    if (process.env.DUMP_DAILY_PDF) writeFileSync(process.env.DUMP_DAILY_PDF, buffer);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(reportNumber).toMatch(/^RPT-\d{8}-[0-9A-F]{6}$/);
    expect(attendance.sectionDaily).toHaveBeenCalledWith(user, 'sec1');
    expect(prisma.report.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'SECTION_ATTENDANCE' }) }));
  });
});

describe('ReportsService.sectionDailyAssessmentPdf', () => {
  const user = { id: 'u1', universityId: 'uni1', roleCodes: ['LECTURER'] } as any;
  const cats = ['การประเมินภาวะสุขภาพ', 'การวินิจฉัยการพยาบาล', 'การวางแผนการพยาบาล', 'การปฏิบัติการพยาบาล', 'การประเมินผล', 'คุณลักษณะวิชาชีพ'];
  const dates = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-17', '2026-11-18', '2026-11-19'];
  const evaluator = { key: 'u1', email: 'rachanon@au.edu', nameEn: 'Rachanon', nameTh: 'อ.รชานนท์' };
  const students = Array.from({ length: 7 }, (_, k) => {
    const cells = dates.map((_, i) => {
      if (i >= 5) return { status: 'UPCOMING', scorePercent: null, criticalFailed: false, sectionScores: null, evaluator: null };
      if (i === 2 && k === 3) return { status: 'ABSENT', scorePercent: null, criticalFailed: false, sectionScores: null, evaluator: null };
      if (i === 4 && k > 4) return { status: 'PENDING', scorePercent: null, criticalFailed: false, sectionScores: null, evaluator: null };
      const v = 62 + ((k * 7 + i * 5) % 35);
      return { status: 'SCORED', scorePercent: v, criticalFailed: k === 6 && i === 1, sectionScores: cats.map((_, c) => v - 5 + c * 2), evaluator };
    });
    return {
      studentId: `s${k}`, studentCode: `65${k}1234`, nameEn: `Student ${k}`, nameTh: k === 2 ? null : `นักศึกษา ทดสอบ${k}`,
      cells, assessedDays: 4, countedDays: 6, itemizedDays: k % 3, dayAverage: 70 + k * 3, sectionAverages: cats.map((_, c) => 68 + c + k), component: 50 + k, points: 35 + k, criticalFailed: k === 6,
      estimate: { estimate: 74 + k * 2.5, grade: ['B', 'B', 'B+', 'B+', 'A', 'A', 'A'][k], gpa: 3, basisWeight: 85, totalWeight: 100 },
    };
  });
  const report = {
    section: { sectionNo: '1', subject: { code: 'NUS3303', nameEn: 'Infant, Child and Adolescent Nursing Practicum II', nameTh: 'ปฏิบัติการพยาบาลทารก เด็ก และวัยรุ่น 2' },
      semester: { nameEn: '1/2026', nameTh: '1/2569' }, lecturer: { nameEn: 'Rachanon Sakol', nameTh: 'รชานนท์ สากล' }, room: { roomNumber: 'Ward 9/4' } },
    rubrics: [{ id: 'r1', nameEn: 'Nursing performance', nameTh: 'การปฏิบัติการพยาบาล', weightPercent: 70 }],
    rubric: { id: 'r1', nameEn: 'Nursing performance', nameTh: 'การปฏิบัติการพยาบาล', weightPercent: 70, sections: cats.map((c, i) => ({ id: `c${i}`, nameEn: `Category ${i + 1}`, nameTh: c, weightPercent: 100 / 6, items: [] })) },
    days: dates.map((date, i) => ({
      sessionId: `d${i}`, date, startTime: '07:00', endTime: '16:00', topic: null, upcoming: i >= 5, enrolled: 7,
      assessed: i >= 5 ? 0 : 6, absent: i === 2 ? 1 : 0, leave: 0, pending: i === 4 ? 2 : 0, average: i >= 5 ? null : 75.2 + i, min: i >= 5 ? null : 62, max: i >= 5 ? null : 96,
      criticalFails: i === 1 ? 1 : 0, sectionAverages: cats.map(() => 75), evaluators: i >= 5 ? [] : [{ ...evaluator, count: 6 }],
    })),
    students,
    totals: { practiceDays: 6, daysAssessed: 5, assessments: 31, itemizedAssessments: 6, pending: 2, average: 77.4, threshold: 70, studentsBelow: 0 },
  };
  const prisma = {
    university: { findUnique: jest.fn().mockResolvedValue({ nameEn: 'Assumption University', nameTh: 'มหาวิทยาลัยอัสสัมชัญ' }) },
    faculty: { findFirst: jest.fn().mockResolvedValue({ nameEn: 'Faculty of Nursing', nameTh: 'คณะพยาบาลศาสตร์' }) },
    report: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const settings = { getMap: jest.fn().mockResolvedValue({ 'pdf.header': '', 'pdf.footer': 'ClassWeb' }) };
  const assessment = { dailyReport: jest.fn().mockResolvedValue(report) };
  const service = new ReportsService(prisma as any, {} as any, assessment as any, settings as any, {} as any);

  it('renders a registered PDF of the daily ward assessment', async () => {
    const { buffer, reportNumber } = await service.sectionDailyAssessmentPdf(user, 'sec1', undefined, 'u1', 'อ.รชานนท์');
    if (process.env.DUMP_DAILY_ASSESSMENT_PDF) writeFileSync(process.env.DUMP_DAILY_ASSESSMENT_PDF, buffer);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(reportNumber).toMatch(/^RPT-\d{8}-[0-9A-F]{6}$/);
    expect(assessment.dailyReport).toHaveBeenCalledWith(user, 'sec1', undefined);
    expect(prisma.report.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'SECTION_DAILY_ASSESSMENT' }) }));
  });

  it('refuses a subject with no daily component', async () => {
    assessment.dailyReport.mockResolvedValueOnce({ ...report, rubric: null, totals: null });
    await expect(service.sectionDailyAssessmentPdf(user, 'sec1', undefined)).rejects.toThrow('no daily');
  });
});

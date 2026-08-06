// Structured data transcribed from the four official NUS 2202 documents
// (semester 1/2026), Bernadette de Lourdes School of Nursing Science:
//
//   1. "Memo Lab exam for NUS 2202-1-2026.pdf"      -> proctors + exam slots
//   2. "Schedule of Lab Exam_NUS 2202.pdf"          -> roster + exam slots
//   3. "Proceduare for Lab Exam_NUS 2202 ... .pdf"  -> midterm lab procedures
//   4. "Midterm Examination for Theory.pdf"         -> theory blueprint
//
// Names are kept EXACTLY as printed in the registrar's document (uppercase,
// no reformatting) — these are official records. The MR./MS. title is the
// document's own statement of gender and is mapped to the Gender enum rather
// than stored in the name field.
//
// Note on international students: many have no Thai name and some have no
// surname at all (e.g. 6812001 "JYOTHI"). nameTh is left null throughout —
// none of the source documents provide Thai names.

export const SUBJECT = {
  code: 'NUS2202',
  nameEn: 'Foundation of Professional Nursing',
  // Credits are not stated in any of the four documents — left at the schema
  // default (3) for an admin to correct in the UI if it differs.
};

/** Proctors named in the memo. Emails are NOT in any document, so no login
 *  accounts are created here — an admin links accounts later via Settings. */
export const LECTURERS = [
  { employeeCode: '330049', nameEn: 'Dr. Pimsiri Bhusiri', position: 'Course Manager, NUS 2202' },
  { employeeCode: '660004', nameEn: 'Dr. Naree Achwarin' },
  { employeeCode: '650026', nameEn: 'Dr. Saw Yu Thanda' },
  { employeeCode: '680060', nameEn: 'A. Rachanon Sakol' },
];

/** studentCode, gender ('MALE' | 'FEMALE'), nameEn — grouped by section. */
export const ROSTER = {
  '71': [
    ['6810163', 'MALE', 'RUTJAGCHOKE ITTHITANINPONTH'],
    ['6810182', 'MALE', 'HASSAN MUDOR'],
    ['6810252', 'FEMALE', 'NATTHANAN TINNAM'],
    ['6810480', 'FEMALE', 'POONYISA KETSAKUL'],
    ['6810725', 'FEMALE', 'NATTAPAT WUNGSANTITUM'],
    ['6810778', 'MALE', 'SUPHACHOT DUSADEEVUTIKUL'],
    ['6810831', 'FEMALE', 'CHANAPORN BUTDEESRI'],
    ['6811142', 'FEMALE', 'FATMATA LAMINE DABO'],
    ['6811181', 'FEMALE', 'THANCHANOK ROJANARAK'],
    ['6811299', 'FEMALE', 'INTANILA PIPITAPAN'],
  ],
  '72': [
    ['6811300', 'FEMALE', 'SUBHARADA YOOVATHAWORN'],
    ['6812006', 'MALE', 'LAMAE JOSHUA'],
    ['6812007', 'FEMALE', 'SHANICE AWINO OYAMO'],
    ['6812011', 'MALE', 'YE PHONE MYAT'],
    ['6812041', 'MALE', 'HTET PYAE SONE AUNG'],
    ['6812154', 'FEMALE', 'ZIMENG LI'],
    ['6830010', 'FEMALE', 'ARAYA KANKING'],
    ['6830024', 'FEMALE', 'KHANITHA SUPHAMARKPHAGDEE'],
    ['6832003', 'MALE', 'SUSAN GHALLEY'],
    ['6710854', 'MALE', 'ATHIKORN WAIDEE'],
  ],
  '73': [
    ['6832024', 'FEMALE', 'MAN JOTH KAUR'],
    ['6832076', 'MALE', 'KHON KHET HTAN'],
    ['6834564', 'MALE', 'MARAN NING JA ZAU RAWNG'],
    ['6810156', 'FEMALE', 'ELONDO NDOLO NGUM'],
    ['6810641', 'MALE', 'RATTHAPATYA YONGPHET'],
    ['6810780', 'FEMALE', 'PIYATHIDA KONGPRASERT'],
    ['6811074', 'FEMALE', 'PIMPAGARN PHOOMPHET'],
    ['6812010', 'FEMALE', 'XINRONG REN'],
    ['6610613', 'FEMALE', 'WAFA NIYOMDHECHA'],
  ],
  '74': [
    ['6810217', 'FEMALE', 'CHOMPHUNUT TANSATHIAN'],
    ['6832009', 'FEMALE', 'JIRAH SHARON GUSTIN'],
    ['6810403', 'FEMALE', 'MONTHARA NILAIYAKA'],
    ['6810584', 'FEMALE', 'PICHAYADA CHOOWAN'],
    ['6810797', 'FEMALE', 'SALINLA KEPAN'],
    ['6810957', 'FEMALE', 'WARINRAMPHAI MEECHOKE'],
    ['6810966', 'FEMALE', 'PEERADA TANPRAYOT'],
    ['6811273', 'FEMALE', 'WARANYA INKAEWMAKE'],
    ['6811118', 'FEMALE', 'PAOLPILART PHOSAEN'],
  ],
  '75': [
    ['6810967', 'MALE', 'THANAT CHANPANYA'],
    ['6812001', 'FEMALE', 'JYOTHI'], // single name — no surname in the source
    ['6812003', 'FEMALE', 'YONG JIA YI'],
    ['6812005', 'MALE', 'AUNG THUREIN OO'],
    ['6812008', 'MALE', 'SAI MOE THU'],
    ['6812015', 'FEMALE', 'TSHERING YANGZOM'],
    ['6812126', 'FEMALE', 'CRISTINE ALMONTE ABATAYO'],
    ['6812142', 'FEMALE', 'SAKAWAH HLAING'],
    ['6812158', 'FEMALE', 'AANAL KALPESHKUMAR NAYAK'],
    ['6812161', 'FEMALE', 'TENZIN YANGCHEN'],
  ],
  '76': [
    ['6812163', 'FEMALE', 'CHARLYN VALDEZ VALDEZ BERGIS'],
    ['6812164', 'MALE', 'YOUFEI WU'],
    ['6814543', 'FEMALE', 'SU SU MIN'],
    ['6814544', 'FEMALE', 'NANG SAING NAUNT'],
    ['6815058', 'FEMALE', 'SHUNN LAE OO'],
    ['6815098', 'FEMALE', 'NYO LAE YEE'],
    ['6810344', 'MALE', 'THANATTHUN PHOTIPRASIT'],
    ['6811139', 'FEMALE', 'LYNDIA MORRIS'],
    ['6812145', 'MALE', 'SIJIE MO'],
    ['6812017', 'FEMALE', 'KARMA WANGMO'],
  ],
};

/**
 * Laboratory examination slots. Times are Bangkok local (UTC+7) exactly as
 * printed; the weekday stated in the memo was verified against the calendar
 * (2026-08-07 is a Friday, 2026-10-08 is a Thursday — both correct).
 */
export const LAB_EXAMS = [
  { kind: 'MIDTERM', date: '2026-08-07', from: '09:00', to: '11:00', sections: ['71', '72'] },
  { kind: 'MIDTERM', date: '2026-08-07', from: '12:00', to: '14:00', sections: ['73', '74'] },
  { kind: 'MIDTERM', date: '2026-08-07', from: '14:00', to: '16:00', sections: ['75', '76'] },
  { kind: 'FINAL', date: '2026-10-08', from: '08:00', to: '11:00', sections: ['75', '76'] },
  { kind: 'FINAL', date: '2026-10-08', from: '12:00', to: '15:00', sections: ['73', '74'] },
  { kind: 'FINAL', date: '2026-10-08', from: '15:00', to: '18:00', sections: ['71', '72'] },
];

/** Midterm lab-exam stations, 15 minutes each (procedure document). */
export const LAB_PROCEDURES = [
  'PPE (mask, cap, gown, gloves) & Hand washing',
  'Occupied bed making',
  'Surgical bed making',
  'Back massage',
  'Vital signs and record',
  'Tepid sponge',
];

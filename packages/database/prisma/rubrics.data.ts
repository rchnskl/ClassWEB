/**
 * The five clinical evaluation rubrics, transcribed from the faculty's Excel
 * forms and translated to Thai for bilingual display. Section weights reflect
 * the forms (Performance's I–VI are given); item weights default to an equal
 * share within each section and are editable in the app. weightPercent on the
 * rubric is a default suggestion — actual grading weight per subject is set
 * via SubjectRubric (a subject may use only a subset of these rubrics).
 */
export interface RubricSeed {
  code: string;
  nameEn: string;
  nameTh: string;
  weightPercent: number;
  order: number;
  sections: { nameEn: string; nameTh: string; weightPercent: number; items: { en: string; th: string }[] }[];
}

export const RUBRICS: RubricSeed[] = [
  {
    code: 'CASE_PRESENTATION',
    nameEn: 'Case study presentation',
    nameTh: 'การนำเสนอกรณีศึกษา',
    weightPercent: 5,
    order: 1,
    sections: [
      {
        nameEn: 'General',
        nameTh: 'ทั่วไป',
        weightPercent: 100,
        items: [
          { en: 'Appropriate methods for presentation', th: 'วิธีการนำเสนอที่เหมาะสม' },
          { en: 'Exhibit knowledge and understanding', th: 'แสดงความรู้และความเข้าใจ' },
          { en: 'Facilitated group process to enhance discussion', th: 'ส่งเสริมกระบวนการกลุ่มเพื่อเพิ่มพูนการอภิปราย' },
          { en: 'Presenter was effective in keeping the discussion focusing on case study', th: 'ผู้นำเสนอสามารถควบคุมการอภิปรายให้อยู่ในประเด็นของกรณีศึกษาได้อย่างมีประสิทธิภาพ' },
          { en: 'Presenter answers the questions clearly', th: 'ผู้นำเสนอตอบคำถามได้ชัดเจน' },
          { en: 'Degree of creativity shown by presenter', th: 'ความคิดสร้างสรรค์ของผู้นำเสนอ' },
          { en: 'Language skills', th: 'ทักษะการใช้ภาษา' },
          { en: 'Summarizing the case study', th: 'การสรุปกรณีศึกษา' },
          { en: 'Time management', th: 'การบริหารเวลา' },
          { en: 'Overall evaluation of the presentation', th: 'การประเมินภาพรวมของการนำเสนอ' },
        ],
      },
    ],
  },
  {
    code: 'CASE_REPORT',
    nameEn: 'Case Study report',
    nameTh: 'รายงานกรณีศึกษา',
    weightPercent: 10,
    order: 2,
    sections: [
      {
        nameEn: '1. Theory',
        nameTh: '1. ทฤษฎี',
        weightPercent: 25,
        items: [
          { en: '1.1 Definition & Etiology', th: '1.1 คำจำกัดความและสาเหตุ' },
          { en: '1.2 Anatomy & Physiology', th: '1.2 กายวิภาคศาสตร์และสรีรวิทยา' },
          { en: '1.3 Pathophysiology', th: '1.3 พยาธิสรีรวิทยา' },
          { en: '1.4 Signs & Symptoms', th: '1.4 อาการและอาการแสดง' },
          { en: '1.5 Medical & Nursing Management', th: '1.5 การรักษาทางการแพทย์และการพยาบาล' },
        ],
      },
      {
        nameEn: '2. Case Study',
        nameTh: '2. กรณีศึกษา',
        weightPercent: 30,
        items: [
          { en: '2.1 Personal data', th: '2.1 ข้อมูลส่วนบุคคล' },
          { en: '2.2 History of illness', th: '2.2 ประวัติการเจ็บป่วย' },
          { en: '2.3 Physical examination', th: '2.3 การตรวจร่างกาย' },
          { en: '2.4 Investigations', th: '2.4 ผลการตรวจทางห้องปฏิบัติการและการตรวจพิเศษ' },
          { en: '2.5 Medical diagnosis and treatment', th: '2.5 การวินิจฉัยโรคและการรักษาทางการแพทย์' },
          { en: '2.6 Comparison between theory and patient (pathophysiology, signs and symptoms)', th: '2.6 การเปรียบเทียบระหว่างทฤษฎีกับผู้ป่วย (พยาธิสรีรวิทยา อาการและอาการแสดง)' },
        ],
      },
      {
        nameEn: '3. Nursing Process',
        nameTh: '3. กระบวนการพยาบาล',
        weightPercent: 35,
        items: [
          { en: '3.1 Priority setting of nursing diagnosis', th: '3.1 การจัดลำดับความสำคัญของข้อวินิจฉัยทางการพยาบาล' },
          { en: '3.2 Identifying sustention of Nursing diagnosis', th: '3.2 การระบุข้อมูลสนับสนุนข้อวินิจฉัยทางการพยาบาล' },
          { en: '3.3 Identifying of nursing goals', th: '3.3 การกำหนดเป้าหมายทางการพยาบาล' },
          { en: '3.4 Identifying of outcome criteria', th: '3.4 การกำหนดเกณฑ์การประเมินผลลัพธ์' },
          { en: '3.5 Nursing actions with rationalization', th: '3.5 กิจกรรมการพยาบาลพร้อมเหตุผลเชิงวิชาการ' },
          { en: '3.6 Relationship of Nursing care & Treatment', th: '3.6 ความสัมพันธ์ระหว่างการพยาบาลกับการรักษา' },
          { en: "3.7 Evaluate patient's outcome", th: '3.7 การประเมินผลลัพธ์ของผู้ป่วย' },
          { en: '3.8 Health education for hospitalization/home care', th: '3.8 การให้สุขศึกษาสำหรับการรักษาในโรงพยาบาล/การดูแลที่บ้าน' },
        ],
      },
      {
        nameEn: '4. Summarization of Case Study',
        nameTh: '4. การสรุปกรณีศึกษา',
        weightPercent: 10,
        items: [{ en: 'Summarization of Case Study', th: 'การสรุปกรณีศึกษา' }],
      },
    ],
  },
  {
    code: 'CLINICAL_TEACHING',
    nameEn: 'Clinical Teaching',
    nameTh: 'การสอนภาคปฏิบัติ',
    weightPercent: 5,
    order: 3,
    sections: [
      {
        nameEn: 'General',
        nameTh: 'ทั่วไป',
        weightPercent: 100,
        items: [
          { en: 'Exhibit knowledge related to the contents', th: 'แสดงความรู้ที่เกี่ยวข้องกับเนื้อหา' },
          { en: 'Use appropriate teaching materials', th: 'ใช้สื่อการสอนที่เหมาะสม' },
          { en: 'Encourage the audiences to participate in discussion', th: 'กระตุ้นให้ผู้ฟังมีส่วนร่วมในการอภิปราย' },
          { en: 'Answer the questions clearly', th: 'ตอบคำถามได้ชัดเจน' },
          { en: 'Personality and voices', th: 'บุคลิกภาพและน้ำเสียง' },
          { en: 'Language skills', th: 'ทักษะการใช้ภาษา' },
          { en: 'Summarize the contents', th: 'สรุปเนื้อหา' },
          { en: 'Time management', th: 'การบริหารเวลา' },
        ],
      },
    ],
  },
  {
    code: 'CLINICAL_EVALUATION',
    nameEn: 'Clinical Evaluation (Performance)',
    nameTh: 'การประเมินผลการปฏิบัติงานทางคลินิก',
    weightPercent: 70,
    order: 4,
    sections: [
      {
        nameEn: 'I. Nursing Performance',
        nameTh: 'I. การปฏิบัติการพยาบาล',
        weightPercent: 40,
        items: [
          { en: "Collect systematically and validate accurately data describe the client's condition", th: 'รวบรวมและตรวจสอบความถูกต้องของข้อมูลที่แสดงสภาวะของผู้ป่วยอย่างเป็นระบบ' },
          { en: 'Identify actual and potential psychological and physiological interferences with client', th: 'ระบุปัญหาทางจิตใจและร่างกายทั้งที่เกิดขึ้นจริงและที่อาจเกิดขึ้นกับผู้ป่วย' },
          { en: 'Identify nursing diagnoses appropriately for the client alterations', th: 'ระบุข้อวินิจฉัยทางการพยาบาลได้อย่างเหมาะสมกับความผิดปกติของผู้ป่วย' },
          { en: 'Establish priorities of care and set realistic client-centered goals', th: 'จัดลำดับความสำคัญของการดูแลและกำหนดเป้าหมายที่เน้นผู้ป่วยเป็นศูนย์กลางอย่างสอดคล้องกับความเป็นจริง' },
          { en: "Set the realistic client behavioral goals based on inferences which are realistic to the client's alterations", th: 'กำหนดเป้าหมายด้านพฤติกรรมของผู้ป่วยที่สอดคล้องกับความเป็นจริงโดยอาศัยการวิเคราะห์ความผิดปกติของผู้ป่วย' },
          { en: 'Organize and develop plan of care based on Self-care theories', th: 'จัดทำและพัฒนาแผนการดูแลโดยใช้ทฤษฎีการดูแลตนเองเป็นพื้นฐาน' },
          { en: 'Implement plans as appropriate client situation', th: 'ปฏิบัติตามแผนการพยาบาลให้เหมาะสมกับสถานการณ์ของผู้ป่วย' },
          { en: 'Formulate nursing interventions to promote self-care in acute and chronic alterations', th: 'กำหนดกิจกรรมการพยาบาลเพื่อส่งเสริมการดูแลตนเองในภาวะเฉียบพลันและเรื้อรัง' },
          { en: 'Administer dependent nursing care safely', th: 'ให้การพยาบาลตามแผนการรักษาของแพทย์อย่างปลอดภัย' },
          { en: 'Carry out independent nursing care safely', th: 'ให้การพยาบาลอิสระอย่างปลอดภัย' },
          { en: 'Evaluate goal achievement of nursing interventions', th: 'ประเมินผลสำเร็จของเป้าหมายจากกิจกรรมการพยาบาล' },
          { en: 'Demonstrate applications of nursing process in writing', th: 'แสดงการประยุกต์ใช้กระบวนการพยาบาลในรูปแบบลายลักษณ์อักษร' },
        ],
      },
      {
        nameEn: 'II. Knowledge',
        nameTh: 'II. ความรู้',
        weightPercent: 20,
        items: [
          { en: 'Compare and contrast normal and abnormal signs, symptoms, and behaviors', th: 'เปรียบเทียบความแตกต่างระหว่างอาการ อาการแสดง และพฤติกรรมปกติกับผิดปกติ' },
          { en: 'Identify significant features of pathophysiology underlying altered health status', th: 'ระบุลักษณะสำคัญของพยาธิสรีรวิทยาที่เป็นสาเหตุของภาวะสุขภาพที่เปลี่ยนแปลงไป' },
          { en: "Identify abnormal lab data, diagnosis tests that describe its clinical significance in terms of client's condition", th: 'ระบุผลตรวจทางห้องปฏิบัติการและการวินิจฉัยที่ผิดปกติ พร้อมอธิบายความสำคัญทางคลินิกที่สัมพันธ์กับภาวะของผู้ป่วย' },
          { en: 'Utilize current literature to validate application of nursing care (rationale)', th: 'ใช้ข้อมูลวิชาการที่ทันสมัยเพื่อสนับสนุนการให้เหตุผลในการพยาบาล' },
          { en: 'Identifies factors that influence and/or affect changes in the acute and/or chronic altered health status', th: 'ระบุปัจจัยที่มีผลต่อการเปลี่ยนแปลงภาวะสุขภาพทั้งเฉียบพลันและเรื้อรัง' },
          { en: 'Describe the meaning strategy to guide client for coping/adaptation/self-abilities', th: 'อธิบายกลยุทธ์ที่มีความหมายเพื่อช่วยเหลือผู้ป่วยในการเผชิญปัญหา ปรับตัว และพึ่งพาตนเอง' },
        ],
      },
      {
        nameEn: 'III. Safety',
        nameTh: 'III. ความปลอดภัย',
        weightPercent: 10,
        items: [
          { en: 'Apply scientific principles in the performance of nursing interventions', th: 'ประยุกต์ใช้หลักการทางวิทยาศาสตร์ในการปฏิบัติกิจกรรมการพยาบาล' },
          { en: 'Recognize client responses to nursing interventions and takes appropriate action to maximize client safety', th: 'ตระหนักถึงการตอบสนองของผู้ป่วยต่อกิจกรรมการพยาบาลและดำเนินการอย่างเหมาะสมเพื่อความปลอดภัยสูงสุดของผู้ป่วย' },
          { en: 'Perform appropriate actions to maintain safe environment', th: 'ปฏิบัติเพื่อรักษาสิ่งแวดล้อมที่ปลอดภัยอย่างเหมาะสม' },
          { en: 'Demonstrate the decision making abilities when performing nursing intervention safety and privacy', th: 'แสดงความสามารถในการตัดสินใจขณะปฏิบัติกิจกรรมการพยาบาลด้านความปลอดภัยและความเป็นส่วนตัว' },
          { en: 'Knowledge of specific drugs specific to their use, action, side effects, adverse effects', th: 'ความรู้เกี่ยวกับยาเฉพาะโรค การใช้ ฤทธิ์ของยา อาการข้างเคียง และอาการไม่พึงประสงค์' },
          { en: 'Knowledge of nursing implications on all therapeutic measures and in drugs', th: 'ความรู้เกี่ยวกับข้อพึงระวังทางการพยาบาลในมาตรการการรักษาและการใช้ยาทั้งหมด' },
          { en: 'Knowledge of principles on transferring safety', th: 'ความรู้เกี่ยวกับหลักการเคลื่อนย้ายผู้ป่วยอย่างปลอดภัย' },
          { en: 'Knowledge of preparation, calculations and correction administration of IV/drugs', th: 'ความรู้เกี่ยวกับการเตรียม การคำนวณ และการบริหารสารน้ำ/ยาทางหลอดเลือดดำอย่างถูกต้อง' },
        ],
      },
      {
        nameEn: 'IV. Communication',
        nameTh: 'IV. การสื่อสาร',
        weightPercent: 10,
        items: [
          { en: 'Utilize effective communication skills with client and family, also communicates effectively with members of the health care team', th: 'ใช้ทักษะการสื่อสารที่มีประสิทธิภาพกับผู้ป่วยและครอบครัว รวมถึงสื่อสารอย่างมีประสิทธิภาพกับทีมสุขภาพ' },
          { en: 'Establish effective interpersonal relationships with health care team', th: 'สร้างสัมพันธภาพระหว่างบุคคลที่ดีกับทีมสุขภาพ' },
          { en: "Check and respond appropriately on client's chart, laboratory results, analyzing values", th: 'ตรวจสอบและตอบสนองต่อเวชระเบียนผู้ป่วย ผลตรวจทางห้องปฏิบัติการ และการวิเคราะห์ค่าต่าง ๆ ได้อย่างเหมาะสม' },
          { en: 'Use medical/scientific terminology correctly in oral and written communication', th: 'ใช้ศัพท์ทางการแพทย์/วิทยาศาสตร์อย่างถูกต้องทั้งในการสื่อสารด้วยวาจาและลายลักษณ์อักษร' },
          { en: 'Report accurately information to instructor and staff nurse', th: 'รายงานข้อมูลแก่อาจารย์และพยาบาลประจำการอย่างถูกต้อง' },
          { en: 'Record accurately, concise, and current', th: 'บันทึกข้อมูลอย่างถูกต้อง กระชับ และเป็นปัจจุบัน' },
          { en: 'Maintain confidentiality of client information', th: 'รักษาความลับข้อมูลของผู้ป่วย' },
          { en: 'Demonstrate analysis and evaluation of nurse-client communication in writing', th: 'แสดงการวิเคราะห์และประเมินการสื่อสารระหว่างพยาบาลกับผู้ป่วยในรูปแบบลายลักษณ์อักษร' },
          { en: 'Apply an understanding of verbal and nonverbal communication in making inferences about client concerns and needs', th: 'ประยุกต์ใช้ความเข้าใจในการสื่อสารทั้งวัจนภาษาและอวัจนภาษาเพื่อวิเคราะห์ความกังวลและความต้องการของผู้ป่วย' },
          { en: 'Provide client-family teaching correctly based on nursing principles, procedures and techniques', th: 'ให้การสอนผู้ป่วยและครอบครัวอย่างถูกต้องตามหลักการ ขั้นตอน และเทคนิคทางการพยาบาล' },
          { en: 'Collaborate with members of the health care team', th: 'ประสานความร่วมมือกับทีมสุขภาพ' },
        ],
      },
      {
        nameEn: 'V. Professional Attitude',
        nameTh: 'V. เจตคติเชิงวิชาชีพ',
        weightPercent: 10,
        items: [
          { en: 'Adhere to professional, legal, and ethical guidelines as designated by the profession of nursing and the Nurse Practice Act', th: 'ปฏิบัติตามแนวทางวิชาชีพ กฎหมาย และจริยธรรมตามที่วิชาชีพการพยาบาลและพระราชบัญญัติวิชาชีพการพยาบาลกำหนด' },
          { en: 'Take initiative to prepare ahead for clinical', th: 'มีความคิดริเริ่มในการเตรียมความพร้อมล่วงหน้าก่อนขึ้นฝึกปฏิบัติ' },
          { en: 'Submit assignments when due', th: 'ส่งงานที่ได้รับมอบหมายตรงเวลา' },
          { en: 'Utilize clinical time and instructor to enhance learning and improve performance', th: 'ใช้เวลาฝึกปฏิบัติและคำแนะนำของอาจารย์เพื่อเสริมสร้างการเรียนรู้และพัฒนาการปฏิบัติงาน' },
          { en: 'Accept extra tasks and is flexible', th: 'ยอมรับงานเพิ่มเติมและมีความยืดหยุ่น' },
          { en: 'Professional attire and appearance is consistent with regulations specified in the student handbook', th: 'แต่งกายและมีบุคลิกภาพตามระเบียบที่กำหนดไว้ในคู่มือนักศึกษา' },
          { en: 'Work cooperatively with others', th: 'ทำงานร่วมกับผู้อื่นอย่างมีความร่วมมือ' },
          { en: 'Assume responsibilities for helping to make clinical activities successful learning experiences', th: 'รับผิดชอบในการช่วยให้กิจกรรมการฝึกปฏิบัติเป็นประสบการณ์การเรียนรู้ที่ประสบความสำเร็จ' },
          { en: 'Recognize own limitations and identifies strategies to remedial', th: 'ตระหนักถึงข้อจำกัดของตนเองและกำหนดแนวทางในการปรับปรุงแก้ไข' },
          { en: "Evaluate own professional behavior and change the behavior when necessary for self and other's well-being", th: 'ประเมินพฤติกรรมเชิงวิชาชีพของตนเองและปรับเปลี่ยนพฤติกรรมเมื่อจำเป็นเพื่อความผาสุกของตนเองและผู้อื่น' },
        ],
      },
      {
        nameEn: 'VI. Leadership',
        nameTh: 'VI. ภาวะผู้นำ',
        weightPercent: 10,
        items: [
          { en: 'Use appropriate interpersonal techniques to establish and maintain therapeutic relationships with health care members', th: 'ใช้เทคนิคสัมพันธภาพระหว่างบุคคลที่เหมาะสมในการสร้างและรักษาสัมพันธภาพเชิงบำบัดกับบุคลากรทางสุขภาพ' },
          { en: 'Enhance the interpersonal capabilities and skills to promote the collaborate goals of hospital and nursing school', th: 'เสริมสร้างความสามารถและทักษะระหว่างบุคคลเพื่อส่งเสริมเป้าหมายความร่วมมือระหว่างโรงพยาบาลและสถาบันการศึกษาพยาบาล' },
          { en: 'Cooperate and adjust to other health team members to ensure delivery of client care', th: 'ให้ความร่วมมือและปรับตัวเข้ากับทีมสุขภาพเพื่อให้การดูแลผู้ป่วยเป็นไปอย่างต่อเนื่อง' },
          { en: 'Insure to take responsibility and delivery of appropriate nursing care within a reasonable period of time', th: 'รับผิดชอบและให้การพยาบาลที่เหมาะสมภายในระยะเวลาที่เหมาะสม' },
          { en: 'Demonstrate effective decision making in creating thinking and enthusiasm', th: 'แสดงการตัดสินใจที่มีประสิทธิภาพด้วยความคิดสร้างสรรค์และความกระตือรือร้น' },
          { en: 'Present a self-confidence as a health team leader', th: 'แสดงความมั่นใจในตนเองในฐานะผู้นำทีมสุขภาพ' },
        ],
      },
    ],
  },
  {
    code: 'PRE_POST_CONFERENCE',
    nameEn: 'Pre-post Conference',
    nameTh: 'การประชุมก่อน-หลังปฏิบัติงาน',
    weightPercent: 10,
    order: 5,
    sections: [
      {
        nameEn: 'General',
        nameTh: 'ทั่วไป',
        weightPercent: 100,
        items: [
          { en: 'Medical diagnosis (and operation)', th: 'การวินิจฉัยโรคทางการแพทย์ (และการผ่าตัด)' },
          { en: 'Chief complaint', th: 'อาการสำคัญที่มาโรงพยาบาล' },
          { en: 'Present & past history of illness', th: 'ประวัติการเจ็บป่วยปัจจุบันและอดีต' },
          { en: 'Abnormal results of investigations', th: 'ผลการตรวจทางห้องปฏิบัติการที่ผิดปกติ' },
          { en: 'Expressing the knowledge of disease', th: 'การแสดงความรู้เกี่ยวกับโรค' },
          { en: 'Medical management', th: 'การรักษาทางการแพทย์' },
          { en: 'Determining nursing diagnosis', th: 'การกำหนดข้อวินิจฉัยทางการพยาบาล' },
          { en: 'Determining nursing interventions', th: 'การกำหนดกิจกรรมการพยาบาล' },
          { en: 'Evaluating the results of nursing interventions', th: 'การประเมินผลลัพธ์ของกิจกรรมการพยาบาล' },
          { en: 'Personality & presentation', th: 'บุคลิกภาพและการนำเสนอ' },
        ],
      },
    ],
  },
];

/** Default grade scheme — the faculty's A–F scale; minScore values are editable. */
export const GRADE_BANDS = [
  { grade: 'A', gpa: 4.0, label: 'Excellent', minScore: 80 },
  { grade: 'A-', gpa: 3.75, label: 'Almost Excellent', minScore: 75 },
  { grade: 'B+', gpa: 3.25, label: 'Very Good', minScore: 70 },
  { grade: 'B', gpa: 3.0, label: 'Good', minScore: 65 },
  { grade: 'B-', gpa: 2.75, label: 'Fairly Good', minScore: 60 },
  { grade: 'C+', gpa: 2.25, label: 'Fair', minScore: 55 },
  { grade: 'C', gpa: 2.0, label: 'Satisfactory', minScore: 50 },
  { grade: 'C-', gpa: 1.75, label: 'Minimum Satisfactory', minScore: 45 },
  { grade: 'D', gpa: 1.0, label: 'Poor', minScore: 40 },
  { grade: 'F', gpa: 0.0, label: 'Failure', minScore: 0 },
];

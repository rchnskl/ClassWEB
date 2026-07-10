/**
 * The five clinical evaluation rubrics, transcribed from the faculty's Excel
 * forms. Section weights reflect the forms (Performance's I–VI are given);
 * item weights default to an equal share within each section and are editable
 * in the app. weightPercent on the rubric is its share of the final grade.
 */
export interface RubricSeed {
  code: string;
  name: string;
  weightPercent: number;
  order: number;
  sections: { name: string; weightPercent: number; items: string[] }[];
}

export const RUBRICS: RubricSeed[] = [
  {
    code: 'CASE_PRESENTATION',
    name: 'Case study presentation',
    weightPercent: 5,
    order: 1,
    sections: [
      {
        name: 'General',
        weightPercent: 100,
        items: [
          'Appropriate methods for presentation',
          'Exhibit knowledge and understanding',
          'Facilitated group process to enhance discussion',
          'Presenter was effective in keeping the discussion focusing on case study',
          'Presenter answers the questions clearly',
          'Degree of creativity shown by presenter',
          'Language skills',
          'Summarizing the case study',
          'Time management',
          'Overall evaluation of the presentation',
        ],
      },
    ],
  },
  {
    code: 'CASE_REPORT',
    name: 'Case Study report',
    weightPercent: 10,
    order: 2,
    sections: [
      {
        name: '1. Theory',
        weightPercent: 25,
        items: [
          '1.1 Definition & Etiology',
          '1.2 Anatomy & Physiology',
          '1.3 Pathophysiology',
          '1.4 Signs & Symptoms',
          '1.5 Medical & Nursing Management',
        ],
      },
      {
        name: '2. Case Study',
        weightPercent: 30,
        items: [
          '2.1 Personal data',
          '2.2 History of illness',
          '2.3 Physical examination',
          '2.4 Investigations',
          '2.5 Medical diagnosis and treatment',
          '2.6 Comparison between theory and patient (pathophysiology, signs and symptoms)',
        ],
      },
      {
        name: '3. Nursing Process',
        weightPercent: 35,
        items: [
          '3.1 Priority setting of nursing diagnosis',
          '3.2 Identifying sustention of Nursing diagnosis',
          '3.3 Identifying of nursing goals',
          '3.4 Identifying of outcome criteria',
          '3.5 Nursing actions with rationalization',
          '3.6 Relationship of Nursing care & Treatment',
          "3.7 Evaluate patient's outcome",
          '3.8 Health education for hospitalization/home care',
        ],
      },
      {
        name: '4. Summarization of Case Study',
        weightPercent: 10,
        items: ['Summarization of Case Study'],
      },
    ],
  },
  {
    code: 'CLINICAL_TEACHING',
    name: 'Clinical Teaching',
    weightPercent: 5,
    order: 3,
    sections: [
      {
        name: 'General',
        weightPercent: 100,
        items: [
          'Exhibit knowledge related to the contents',
          'Use appropriate teaching materials',
          'Encourage the audiences to participate in discussion',
          'Answer the questions clearly',
          'Personality and voices',
          'Language skills',
          'Summarize the contents',
          'Time management',
        ],
      },
    ],
  },
  {
    code: 'CLINICAL_EVALUATION',
    name: 'Clinical Evaluation (Performance)',
    weightPercent: 70,
    order: 4,
    sections: [
      {
        name: 'I. Nursing Performance',
        weightPercent: 40,
        items: [
          "Collect systematically and validate accurately data describe the client's condition",
          'Identify actual and potential psychological and physiological interferences with client',
          'Identify nursing diagnoses appropriately for the client alterations',
          'Establish priorities of care and set realistic client-centered goals',
          "Set the realistic client behavioral goals based on inferences which are realistic to the client's alterations",
          'Organize and develop plan of care based on Self-care theories',
          'Implement plans as appropriate client situation',
          'Formulate nursing interventions to promote self-care in acute and chronic alterations',
          'Administer dependent nursing care safely',
          'Carry out independent nursing care safely',
          'Evaluate goal achievement of nursing interventions',
          'Demonstrate applications of nursing process in writing',
        ],
      },
      {
        name: 'II. Knowledge',
        weightPercent: 20,
        items: [
          'Compare and contrast normal and abnormal signs, symptoms, and behaviors',
          'Identify significant features of pathophysiology underlying altered health status',
          "Identify abnormal lab data, diagnosis tests that describe its clinical significance in terms of client's condition",
          'Utilize current literature to validate application of nursing care (rationale)',
          'Identifies factors that influence and/or affect changes in the acute and/or chronic altered health status',
          'Describe the meaning strategy to guide client for coping/adaptation/self-abilities',
        ],
      },
      {
        name: 'III. Safety',
        weightPercent: 10,
        items: [
          'Apply scientific principles in the performance of nursing interventions',
          'Recognize client responses to nursing interventions and takes appropriate action to maximize client safety',
          'Perform appropriate actions to maintain safe environment',
          'Demonstrate the decision making abilities when performing nursing intervention safety and privacy',
          'Knowledge of specific drugs specific to their use, action, side effects, adverse effects',
          'Knowledge of nursing implications on all therapeutic measures and in drugs',
          'Knowledge of principles on transferring safety',
          'Knowledge of preparation, calculations and correction administration of IV/drugs',
        ],
      },
      {
        name: 'IV. Communication',
        weightPercent: 10,
        items: [
          'Utilize effective communication skills with client and family, also communicates effectively with members of the health care team',
          'Establish effective interpersonal relationships with health care team',
          "Check and respond appropriately on client's chart, laboratory results, analyzing values",
          'Use medical/scientific terminology correctly in oral and written communication',
          'Report accurately information to instructor and staff nurse',
          'Record accurately, concise, and current',
          'Maintain confidentiality of client information',
          'Demonstrate analysis and evaluation of nurse-client communication in writing',
          'Apply an understanding of verbal and nonverbal communication in making inferences about client concerns and needs',
          'Provide client-family teaching correctly based on nursing principles, procedures and techniques',
          'Collaborate with members of the health care team',
        ],
      },
      {
        name: 'V. Professional Attitude',
        weightPercent: 10,
        items: [
          'Adhere to professional, legal, and ethical guidelines as designated by the profession of nursing and the Nurse Practice Act',
          'Take initiative to prepare ahead for clinical',
          'Submit assignments when due',
          'Utilize clinical time and instructor to enhance learning and improve performance',
          'Accept extra tasks and is flexible',
          'Professional attire and appearance is consistent with regulations specified in the student handbook',
          'Work cooperatively with others',
          'Assume responsibilities for helping to make clinical activities successful learning experiences',
          'Recognize own limitations and identifies strategies to remedial',
          "Evaluate own professional behavior and change the behavior when necessary for self and other's well-being",
        ],
      },
      {
        name: 'VI. Leadership',
        weightPercent: 10,
        items: [
          'Use appropriate interpersonal techniques to establish and maintain therapeutic relationships with health care members',
          'Enhance the interpersonal capabilities and skills to promote the collaborate goals of hospital and nursing school',
          'Cooperate and adjust to other health team members to ensure delivery of client care',
          'Insure to take responsibility and delivery of appropriate nursing care within a reasonable period of time',
          'Demonstrate effective decision making in creating thinking and enthusiasm',
          'Present a self-confidence as a health team leader',
        ],
      },
    ],
  },
  {
    code: 'PRE_POST_CONFERENCE',
    name: 'Pre-post Conference',
    weightPercent: 10,
    order: 5,
    sections: [
      {
        name: 'General',
        weightPercent: 100,
        items: [
          'Medical diagnosis (and operation)',
          'Chief complaint',
          'Present & past history of illness',
          'Abnormal results of investigations',
          'Expressing the knowledge of disease',
          'Medical management',
          'Determining nursing diagnosis',
          'Determining nursing interventions',
          'Evaluating the results of nursing interventions',
          'Personality & presentation',
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

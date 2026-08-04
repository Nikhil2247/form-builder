import { FormConfig, FormSubmission } from '@/types/form';

export const SAMPLE_FORMS: FormConfig[] = [
  {
    id: 'customer-feedback-01',
    title: 'Enterprise Product Feedback & Survey',
    description: 'Share your feedback to help us shape the future of our SaaS platform.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pages: [
      { pageNumber: 1, title: 'Overall Experience', description: 'General thoughts on our app.' },
      { pageNumber: 2, title: 'Feature Ratings & Details', description: 'Rate individual tools.' }
    ],
    theme: {
      preset: 'indigo',
      primaryColor: '#6366f1',
      backgroundColor: '#f8fafc',
      cardColor: '#ffffff',
      textColor: '#0f172a',
      fontFamily: 'Inter',
      borderRadius: 'lg',
      cardVariant: 'elevated',
      coverImageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=1200&auto=format&fit=crop'
    },
    logic: [],
    questions: [
      {
        id: 'q-name',
        type: 'SHORT_TEXT',
        label: 'Full Name',
        placeholder: 'e.g., Jane Smith',
        required: true,
        validation: { required: true },
        colSpan: 1,
        pageNumber: 1
      },
      {
        id: 'q-email',
        type: 'EMAIL',
        label: 'Work Email Address',
        placeholder: 'jane@company.com',
        required: true,
        validation: { required: true },
        colSpan: 1,
        pageNumber: 1
      },
      {
        id: 'q-role',
        type: 'SINGLE_CHOICE',
        label: 'What is your primary role?',
        options: [
          { id: 'o1', label: 'Product Manager / Designer', value: 'pm_designer', isCorrect: false },
          { id: 'o2', label: 'Software Engineer', value: 'engineer', isCorrect: false },
          { id: 'o3', label: 'Executive / Founder', value: 'executive', isCorrect: false }
        ],
        validation: { required: false },
        colSpan: 2,
        pageNumber: 1
      },
      {
        id: 'q-rating-star',
        type: 'STAR_RATING',
        label: 'Overall Platform Satisfaction Rating',
        validation: { required: true },
        colSpan: 2,
        pageNumber: 2
      },
      {
        id: 'q-features',
        type: 'MULTI_CHOICE',
        label: 'Which features do you use most frequently?',
        options: [
          { id: 'f1', label: 'Drag & Drop Canvas Builder', value: 'builder' },
          { id: 'f2', label: 'Excel & Data Exporting', value: 'excel_export' },
          { id: 'f3', label: 'Conditional Logic Branching', value: 'logic' }
        ],
        validation: { required: false },
        colSpan: 2,
        pageNumber: 2
      }
    ]
  },

  {
    id: 'tech-quiz-02',
    title: 'General Tech & Coding Knowledge Quiz',
    description: 'Test your understanding of modern web development and software architecture.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pages: [{ pageNumber: 1, title: 'Quiz Questions', description: 'Answer all questions to get your score.' }],
    theme: {
      preset: 'purple',
      primaryColor: '#8b5cf6',
      backgroundColor: '#f3e8ff',
      cardColor: '#ffffff',
      textColor: '#3b0764',
      fontFamily: 'Inter',
      borderRadius: 'lg',
      cardVariant: 'card'
    },
    logic: [],
    questions: [
      {
        id: 'qz-1',
        type: 'SINGLE_CHOICE',
        label: 'Which language is natively supported by web browsers for client-side interactivity?',
        options: [
          { id: 'qo1', label: 'Java', value: 'java', isCorrect: false },
          { id: 'qo2', label: 'JavaScript', value: 'js', isCorrect: true },
          { id: 'qo3', label: 'Python', value: 'python', isCorrect: false },
          { id: 'qo4', label: 'C++', value: 'cpp', isCorrect: false }
        ],
        points: 5,
        explanation: 'JavaScript (along with WebAssembly) is the standard programming language executed natively in all modern web browsers.',
        validation: { required: true },
        colSpan: 2,
        pageNumber: 1
      },
      {
        id: 'qz-2',
        type: 'SINGLE_CHOICE',
        label: 'What does CSS stand for in web development?',
        options: [
          { id: 'qo21', label: 'Creative Style Sheets', value: 'css1', isCorrect: false },
          { id: 'qo22', label: 'Cascading Style Sheets', value: 'css2', isCorrect: true },
          { id: 'qo23', label: 'Computer System Sheets', value: 'css3', isCorrect: false }
        ],
        points: 5,
        explanation: 'CSS stands for Cascading Style Sheets, used to style HTML document elements.',
        validation: { required: true },
        colSpan: 2,
        pageNumber: 1
      }
    ]
  }
];

export const MOCK_SUBMISSIONS: Record<string, FormSubmission[]> = {
  'customer-feedback-01': [
    {
      id: 'sub-101',
      formId: 'customer-feedback-01',
      submittedAt: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
      completionTimeMs: 145000,
      answers: {
        'q-name': 'Alice Johnson',
        'q-email': 'alice.johnson@techcorp.io',
        'q-role': 'Product Manager / Designer',
        'q-rating-star': 5,
        'q-features': ['Drag & Drop Canvas Builder', 'Excel & Data Exporting']
      }
    }
  ],
  'tech-quiz-02': [
    {
      id: 'sub-201',
      formId: 'tech-quiz-02',
      submittedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
      completionTimeMs: 65000,
      quizScore: 10,
      maxQuizScore: 10,
      answers: {
        'qz-1': 'JavaScript',
        'qz-2': 'Cascading Style Sheets'
      }
    }
  ]
};

export interface CandidateProfile {
  personalInfo: {
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    phone: string;
    address: {
      street: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    };
    linkedin: string;
    github: string;
    website: string;
    gender?: string;
  };
  workExperience: Array<{
    jobTitle: string;
    company: string;
    location: string;
    startDate: string;
    endDate: string;
    isCurrent: boolean;
    description: string;
  }>;
  education: Array<{
    institution: string;
    degree: string;
    fieldOfStudy: string;
    startDate: string;
    endDate: string;
    gpa?: string;
  }>;
  skills: string[];
  certifications: string[];
  summary: string;
  projects?: Array<{
    title: string;
    description: string;
    technologies?: string[];
    url?: string;
  }>;
  hyperlinks?: string[];
  languages?: string[];
  eeoDisclosures?: {
    gender?: string;
    raceEthnicity?: string;
    veteranStatus?: string;
    disabilityStatus?: string;
    workAuthorization?: string;
    requiresSponsorship?: string;
  };
  customAttributes?: Record<string, string>;
  analysisCompleted?: boolean;
  analysisPassesCount?: number;
  targetQuestionnaireAnswers?: {
    isAtLeast18: boolean;
    isLegallyAuthorizedUS: boolean;
    hasEmploymentAgreementRestrictions: boolean;
    isCurrentOrPastTargetContractor: boolean;
    isReferralAgency: boolean;
    openToRelocation: boolean;
    experienceBeauty: boolean;
    experienceTech: boolean;
    experienceStyle: boolean;
    experienceFood: boolean;
    experienceSalesfloor: boolean;
    experienceWarehousing: boolean;
    experienceCustomerService: boolean;
    yearsLeadingTeam: string;
    yearsStockingSettingSelling: string;
    teamSizeLed: string;
    yearsCoachingDeveloping: string;
    yearsHiringBuildingSalesTeams: string;
    availableWeekendsHolidays: boolean;
    earliestTimeSunday: string;
    earliestTimeMonday: string;
    earliestTimeTuesday: string;
    earliestTimeWednesday: string;
    earliestTimeThursday: string;
    earliestTimeFriday: string;
    earliestTimeSaturday: string;
    additionalAvailabilityComments?: string;
    allowSmsCommunication: boolean;
  };
  resumeAICheckerReport?: {
    checkedBy: string;
    completenessScore: number;
    checkedAt: string;
    verifiedSections: string[];
    enhancementsApplied: string[];
    missingFieldsDetected?: string[];
  };
}

export interface WorkdayFormField {
  id: string;
  automationId?: string;
  label: string;
  type: 'text' | 'select' | 'radio' | 'checkbox' | 'date' | 'textarea' | 'file';
  placeholder?: string;
  options?: string[];
  required?: boolean;
  currentValue?: string;
  sectionContext?: string;
}

export interface MappingInstruction {
  fieldId: string;
  automationId?: string;
  action: 'fill_text' | 'select_option' | 'click_radio' | 'toggle_checkbox' | 'set_date' | 'skip';
  value: string;
  confidence: number;
  reasoning: string;
}

export interface StepStatus {
  stepName: string;
  isWorkdayPage: boolean;
  totalFieldsCount: number;
  filledFieldsCount: number;
  isFinalReviewStep: boolean;
  isCreateAccountFilled?: boolean;
  isSignInFilled?: boolean;
}

export interface MapFieldsRequest {
  candidate: CandidateProfile;
  fields: WorkdayFormField[];
  stepName?: string;
  pageErrors?: Array<{ fieldLabel?: string; message: string }>;
}

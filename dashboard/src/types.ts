export type RelatedToValue =
  | 'Billing'
  | 'Doctor Appointment'
  | 'Prescription'
  | 'Test Report'
  | 'Insurance'
  | 'Emergency'
  | 'General Query'
  | 'Unclear';

export const RELATED_TO_VALUES: RelatedToValue[] = [
  'Billing',
  'Doctor Appointment',
  'Prescription',
  'Test Report',
  'Insurance',
  'Emergency',
  'General Query',
  'Unclear',
];

export interface CallData {
  call_classification?: string;
  recordType?: 'LEAD' | 'TICKET' | 'TICKET_CONFUSION' | 'CONFUSION' | 'PRANK' | 'IVR' | 'NO_ACTION_REQUIRED';
  notes?: string;
  ticket_solution?: string;
  ticket_notes?: string;
  action_description?: string;
  call_solution?: string;
  call_conclusion?: string;
  LeadNotes?: string;
  action_required?: boolean | string;
  follow_up_required?: boolean;
  outcome?: string;
  sentiment_label?: string; // Deprecated: use customer_sentiment_label instead
  sentiment_summary?: string; // Deprecated: use customer_sentiment_summary instead
  customer_sentiment_label?: string;
  customer_sentiment_summary?: string;
  agent_sentiment_label?: string;
  agent_sentiment_summary?: string;
  follow_ups?: string[] | string;
  customer_name?: string;
  phone_number?: string;
  doctor_name?: string;
  hospital_name?: string;
  department?: string;
  services?: string;
  timestamp?: string;
  filename?: string;
  relatedTo?: RelatedToValue;
  nextStep?: string;
  transcript?: string;
}

export interface ProcessingStats {
  total: number;
  lead: number;
  ticket: number;
}

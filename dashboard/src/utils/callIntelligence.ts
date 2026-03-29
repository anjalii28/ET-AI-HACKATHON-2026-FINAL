import { CallData, RelatedToValue, RELATED_TO_VALUES } from '../types';

const EMERGENCY_KEYWORDS = ['pain', 'emergency', 'urgent', 'leak', 'bleeding', 'severe', 'critical', 'ambulance', 'tracheostomy'];

function extractCallCategory(filename?: string): string {
  if (!filename) return 'OTHER';
  const upper = filename.toUpperCase();
  if (upper.includes('POST_DISCHARGE') || upper.includes('POSTDISCHARGE')) return 'POST_DISCHARGE';
  if (upper.includes('EMERGENCY')) return 'EMERGENCY';
  if (upper.includes('HOMECARE') || upper.includes('HOME_CARE')) return 'CUSTOMER_CARE';
  if (upper.includes('APPOINTMENT') || upper.includes('APPT')) return 'APPOINTMENT';
  if (upper.includes('CUSTOMER_CARE') || upper.includes('CUSTOMERCARE')) return 'CUSTOMER_CARE';
  return 'OTHER';
}

export function isActionRequired(call: CallData): boolean {
  const actionReq = call.action_required;
  if (typeof actionReq === 'boolean') return actionReq === true;
  if (typeof actionReq === 'string') {
    const upper = String(actionReq).trim().toUpperCase();
    return (
      upper === 'TRUE' || upper === 'YES' || upper === 'CALLBACK_REQUIRED' ||
      upper === 'ACTION_REQUIRED' || upper.includes('REQUIRED') ||
      upper.includes('CALLBACK') || (upper.includes('ACTION') && !upper.includes('NO_ACTION'))
    );
  }
  return false;
}

export function isHighAnxiety(call: CallData): boolean {
  // Use customer sentiment (with backward compatibility)
  const s = ((call.customer_sentiment_label || call.sentiment_label) || '').toUpperCase();
  return s.includes('ANXIOUS') || s.includes('NEGATIVE') || s.includes('FRUSTRATED') || s.includes('ANGRY');
}

/** SLA limit in milliseconds by category */
function getSLALimitMs(category: string): number {
  switch (category) {
    case 'EMERGENCY': return 2 * 60 * 60 * 1000;   // 2h
    case 'POST_DISCHARGE': return 4 * 60 * 60 * 1000;  // 4h
    case 'CUSTOMER_CARE': return 6 * 60 * 60 * 1000;   // 6h
    default: return 8 * 60 * 60 * 1000;   // 8h
  }
}

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

/** "Waiting since: 2h 14m" */
export function getWaitingSince(timestamp?: string, now = Date.now()): { text: string; ms: number } {
  if (!timestamp) return { text: 'N/A', ms: 0 };
  const callTime = new Date(timestamp).getTime();
  const ms = now - callTime;
  return { text: formatDuration(ms), ms };
}

/** "SLA left: 46 min" or "Overdue 1h" */
export function getSLARemaining(
  timestamp?: string,
  filename?: string,
  now = Date.now()
): { text: string; msLeft: number; isOverdue: boolean; urgency: 'ok' | 'soon' | 'overdue' } {
  if (!timestamp) return { text: 'N/A', msLeft: 0, isOverdue: false, urgency: 'ok' };
  const callTime = new Date(timestamp).getTime();
  const category = extractCallCategory(filename);
  const limitMs = getSLALimitMs(category);
  const elapsed = now - callTime;
  const msLeft = limitMs - elapsed;

  if (msLeft <= 0) {
    return {
      text: `Overdue ${formatDuration(-msLeft)}`,
      msLeft: 0,
      isOverdue: true,
      urgency: 'overdue',
    };
  }

  const oneHour = 60 * 60 * 1000;
  const urgency: 'ok' | 'soon' | 'overdue' = msLeft <= oneHour ? 'soon' : 'ok';

  return {
    text: `${formatDuration(msLeft)} left`,
    msLeft,
    isOverdue: false,
    urgency,
  };
}

/** "Yesterday 6:40 PM" or "Today 10:30 AM" */
export function getLastTouched(timestamp?: string, now = Date.now()): string {
  if (!timestamp) return 'N/A';
  const d = new Date(timestamp);
  const today = new Date(now);
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (isToday) return `Today ${timeStr}`;
  if (isYesterday) return `Yesterday ${timeStr}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Risk score 0-100 from sentiment, emergency, repeat, wait time, action */
export function getRiskScore(
  call: CallData,
  isRepeat: boolean,
  waitMs: number,
  phoneCount: number
): { score: number; tier: 'high' | 'medium' | 'low' } {
  let score = 0;

  // Sentiment (0-25) - use customer sentiment (with backward compatibility)
  const s = ((call.customer_sentiment_label || call.sentiment_label) || '').toUpperCase();
  if (s.includes('FRUSTRATED') || s.includes('ANGRY')) score += 25;
  else if (s.includes('ANXIOUS') || s.includes('NEGATIVE')) score += 18;
  else if (s.includes('NEUTRAL')) score += 5;

  // Emergency / medical (0-25)
  const category = extractCallCategory(call.filename);
  if (category === 'EMERGENCY') score += 25;
  else if (category === 'POST_DISCHARGE') score += 15;

  const text = [
    call.notes,
    call.ticket_solution,
    call.LeadNotes,
    (call as { ticket_notes?: string }).ticket_notes,
    (call as { action_description?: string }).action_description,
  ].join(' ').toLowerCase();
  for (const kw of EMERGENCY_KEYWORDS) {
    if (text.includes(kw)) {
      score += 8;
      break;
    }
  }

  // Repeat (0-20)
  if (phoneCount >= 3) score += 20;
  else if (isRepeat) score += 12;

  // Time waiting (0-20) - longer wait = higher risk
  const hours = waitMs / (60 * 60 * 1000);
  if (hours >= 8) score += 20;
  else if (hours >= 4) score += 15;
  else if (hours >= 2) score += 10;
  else if (hours >= 1) score += 5;

  // Unresolved action (0-10)
  if (isActionRequired(call)) score += 10;

  score = Math.min(100, score);

  const tier: 'high' | 'medium' | 'low' = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return { score, tier };
}

/** "Why am I seeing this?" one-liner */
export function getWhyThisMatters(
  call: CallData,
  phoneCount: number
): string {
  const parts: string[] = [];
  const text = [
    call.notes,
    call.ticket_solution,
    call.LeadNotes,
    (call as { ticket_notes?: string }).ticket_notes,
    (call as { action_description?: string }).action_description,
  ].join(' ');

  if (isActionRequired(call)) {
    const desc = (call as { action_description?: string }).action_description;
    if (desc) {
      const first = desc.split(/[.!]/)[0]?.trim();
      if (first && first.length < 120) return first;
    }
    if (text.toLowerCase().includes('callback')) parts.push('Callback requested');
    else parts.push('Action required');
  }

  if (isHighAnxiety(call)) {
    // Use customer sentiment (with backward compatibility)
    const s = ((call.customer_sentiment_label || call.sentiment_label) || '').toLowerCase();
    if (s.includes('frustrated')) parts.push('Caller frustrated');
    else if (s.includes('anxious')) parts.push('Caller anxious');
  }

  if (phoneCount >= 2) {
    parts.push(`${phoneCount}th call from this number`);
  }

  const lower = text.toLowerCase();
  if (lower.includes('pain') || lower.includes('severe')) parts.push('Severe pain mentioned');
  if (lower.includes('urgent') || lower.includes('emergency')) parts.push('Urgent request');
  if (lower.includes('unresolved') || lower.includes('pending')) parts.push('Previously unresolved');

  if (parts.length > 0) {
    return parts.slice(0, 3).join('. ');
  }

  const first = text.split(/\n|\./)[0]?.trim();
  if (first && first.length < 100) return first;
  return 'Requires review';
}

/** "What if I ignore this?" consequence hint */
export function getConsequenceHint(
  call: CallData,
  riskScore: number,
  isRepeat: boolean
): string {
  if (riskScore >= 70) {
    if (isHighAnxiety(call)) return 'May escalate to complaint';
    const cat = extractCallCategory(call.filename);
    if (cat === 'EMERGENCY' || cat === 'POST_DISCHARGE') return 'Medical delay risk';
    return 'High escalation risk';
  }
  if (isRepeat) return 'Likely repeat call if unresolved';
  if (isActionRequired(call)) return 'Missed commitment';
  return '';
}

/** Related To: domain (controlled list). AI-set, editable by agent. Separate from Classification. */
export function getRelatedTo(call: CallData): { value: RelatedToValue; confidence: 'high' | 'medium' | 'low' } {
  const existing = call.relatedTo;
  if (existing && RELATED_TO_VALUES.includes(existing)) {
    return { value: existing, confidence: 'high' };
  }

  const text = [
    call.notes,
    call.ticket_notes,
    call.action_description,
    call.call_solution,
    call.ticket_solution,
    call.LeadNotes,
    call.services,
    call.department,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const matches: { value: RelatedToValue; score: number }[] = [];

  if (/\bbill\b|\bcharge(d)?\b|\bpayment\b|\bwrongly\s*charged\b|\bcost\b/.test(text)) {
    matches.push({ value: 'Billing', score: 3 });
  }
  if (/\bappointment\b|\bbook(ed|ing)?\b|\bschedule(d|ing)?\b|\bconfirm(ed|ation)?\b|\bdoctor\s*visit\b/.test(text)) {
    matches.push({ value: 'Doctor Appointment', score: 3 });
  }
  if (/\bprescription\b|\bmedicine\b|\bmedication\b|\brefill\b/.test(text)) {
    matches.push({ value: 'Prescription', score: 3 });
  }
  if (/\btest\b|\breport\b|\bresult\b|\blab\b|\bmri\b|\bscan\b|\bx-?ray\b/.test(text)) {
    matches.push({ value: 'Test Report', score: 3 });
  }
  if (/\binsurance\b|\bclaim\b|\bcoverage\b/.test(text)) {
    matches.push({ value: 'Insurance', score: 3 });
  }
  if (/\bemergency\b|\burgent\b|\bambulance\b|\bcritical\b|\bsevere\b/.test(text)) {
    matches.push({ value: 'Emergency', score: 3 });
  }
  if (/\benquir(y|ies)\b|\binquir(y|ies)\b|\bgeneral\b|\binfo\b/.test(text)) {
    matches.push({ value: 'General Query', score: 1 });
  }

  const byValue = new Map<RelatedToValue, number>();
  matches.forEach(({ value, score }) => {
    byValue.set(value, (byValue.get(value) || 0) + score);
  });
  const sorted = Array.from(byValue.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([, s]) => s > 0);

  if (sorted.length === 0) {
    return { value: 'Unclear', confidence: 'low' };
  }
  const [value, score] = sorted[0];
  const confidence: 'high' | 'medium' | 'low' = score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';
  return { value: confidence === 'low' ? 'Unclear' : value, confidence };
}

/** Next Step: short phrase (2–4 words) for after callback. Only when follow-up/ticket exists. */
export const NEXT_STEP_SUGGESTIONS = [
  'Confirm appointment',
  'Resend prescription',
  'Explain charges',
  'Share report',
  'Get doctor approval',
  'Callback patient',
  'Schedule follow-up',
  'Send documents',
  'Verify insurance',
  'Arrange ambulance',
] as const;

/** Determine who needs to perform the action: Agent or Caller */
function determineActor(actionDesc: string, ticketNotes: string, callSolution: string): 'Agent' | 'Caller' {
  const combined = `${actionDesc} ${ticketNotes} ${callSolution}`.toLowerCase();
  
  // ALWAYS agent actions (these should never be caller)
  const alwaysAgentActions = [
    'callback',
    'call back',
    'arrange callback',
    'arrange',
    'coordinate',
    'verify',
    'check',
    'send',
    'share',
    'resend',
    'explain charges',
    'get doctor approval',
  ];
  
  for (const action of alwaysAgentActions) {
    if (combined.includes(action)) return 'Agent';
  }
  
  // Explicit caller/patient mentions (but not for agent actions above)
  const callerIndicators = [
    'caller needs to',
    'patient needs to',
    'customer needs to',
    'they need to',
    'caller should',
    'patient should',
    'caller must',
    'patient must',
    'caller to confirm',
    'patient to confirm',
    'caller to bring',
    'patient to bring',
  ];
  
  // Explicit agent mentions
  const agentIndicators = [
    'agent needs to',
    'agent should',
    'agent must',
    'agent will',
    'agent has',
    'agent noted',
  ];
  
  // Check for explicit mentions
  for (const indicator of callerIndicators) {
    if (combined.includes(indicator)) {
      // But don't return Caller if it's an agent action
      const isAgentAction = alwaysAgentActions.some(a => combined.includes(a));
      if (!isAgentAction) return 'Caller';
    }
  }
  
  for (const indicator of agentIndicators) {
    if (combined.includes(indicator)) return 'Agent';
  }
  
  // Default to Agent for most follow-up actions
  return 'Agent';
}

/** Clean text: remove duplicate actor prefixes and awkward phrasing */
function cleanActionText(text: string, actor: 'Agent' | 'Caller'): string {
  if (!text || text.trim().length === 0) return text;
  
  let cleaned = text.trim();
  
  // Remove existing actor prefixes to avoid duplication
  const prefixesToRemove = [
    'agent needs to',
    'caller needs to',
    'patient needs to',
    'customer needs to',
    'agent should',
    'caller should',
    'patient should',
    'agent must',
    'caller must',
    'agent will',
    'caller will',
    'agent has to',
    'caller has to',
  ];
  
  for (const prefix of prefixesToRemove) {
    const regex = new RegExp(`^${prefix}\\s+`, 'i');
    cleaned = cleaned.replace(regex, '').trim();
  }
  
  // Remove awkward phrases and duplicate actor mentions
  cleaned = cleaned
    .replace(/\b(agent|caller|patient|customer)\s+(needs|should|must|will|has|noted)\s+/gi, '')
    .replace(/\bto\s+to\b/gi, 'to') // "to to" -> "to"
    .replace(/\s+/g, ' ') // Multiple spaces -> single space
    .trim();
  
  // If cleaned text already starts with "Actor needs to", return as-is
  const actorPrefix = `${actor.toLowerCase()} needs to`;
  if (cleaned.toLowerCase().startsWith(actorPrefix)) {
    return cleaned;
  }
  
  return cleaned;
}

/** True when the call content indicates nothing left to do (e.g. already cancelled, already booked). */
export function isNoActionNeeded(call: CallData): boolean {
  // Check outcome field first - direct signal
  const outcome = (call.outcome || '').toUpperCase();
  if (outcome === 'CANCELLED') {
    return true; // Cancelled = no action needed
  }
  
  // Check all text fields including transcript and LeadNotes
  const allText = [
    call.transcript,
    call.customer_sentiment_summary,
    call.agent_sentiment_summary,
    call.sentiment_summary, // Backward compatibility
    call.call_solution,
    call.ticket_solution,
    call.action_description,
    call.LeadNotes,
    call.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  
  const noActionPhrases = [
    // Cancellation phrases - these indicate the matter is already resolved
    'already cancelled',
    'had been cancelled',
    'was cancelled',
    'cancellation was confirmed',
    'confirmed that the appointment had been cancelled',
    'appointment had been cancelled',
    'appointment was cancelled',
    'appointment was already cancelled',
    'the appointment had been cancelled',
    'the appointment was cancelled',
    
    // Booking completion phrases - "already" indicates it was done before this call
    'already booked',
    'booking is already made',
    'already made',
    'appointment was already booked',
    'appointment had been booked',
    'was already booked',
    'the appointment was already booked',
    'the appointment had been booked',
    'already confirmed',
    'appointment was already confirmed',
    'appointment had been confirmed',
    'already scheduled',
    'appointment was already scheduled',
    'appointment had been scheduled',
    
    // General completion phrases
    'call concluded',
    'call ended',
    'no further action',
    'no action required',
    'matter resolved',
    'issue resolved',
  ];
  
  // Check for phrases indicating completion
  const hasCompletionPhrase = noActionPhrases.some((phrase) => allText.includes(phrase));
  
  // Also check: if outcome is BOOKED and there's no action required AND text indicates completion
  if (outcome === 'BOOKED' && !isActionRequired(call)) {
    // Check if the booking was just completed in this call (needs follow-up) vs already existed
    const justBookedPhrases = ['successfully booked', 'was booked', 'appointment was booked', 'booking confirmed'];
    const wasJustBooked = justBookedPhrases.some((phrase) => allText.includes(phrase));
    // If it was just booked in this call but no action required, it's done
    if (wasJustBooked) return true;
  }
  
  return hasCompletionPhrase;
}

/** Check if appointment was successfully booked in this call (not already booked before). */
function wasAppointmentJustBooked(call: CallData): boolean {
  // Check all text fields for booking indicators
  const allText = [
    call.transcript,
    call.call_solution,
    call.customer_sentiment_summary,
    call.agent_sentiment_summary,
    call.sentiment_summary, // Backward compatibility
    call.LeadNotes,
    call.action_description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  
  const justBookedPhrases = [
    'successfully booked',
    'was booked',
    'appointment was booked',
    'appointment was successfully booked',
    'booked for',
    'confirmed and booked',
    'booking confirmed',
    'appointment confirmed',
    'the caller successfully booked',
    'the agent confirmed and booked',
    'booked the appointment',
  ];
  
  const alreadyBookedPhrases = [
    'already booked',
    'was already booked',
    'appointment was already booked',
    'had been booked',
    'appointment had been booked',
  ];
  
  // If it contains "already booked" phrases, it wasn't just booked
  if (alreadyBookedPhrases.some(phrase => allText.includes(phrase))) {
    return false;
  }
  
  // Check if it contains "just booked" phrases
  const hasBookingPhrase = justBookedPhrases.some(phrase => allText.includes(phrase));
  
  // Also check outcome field as additional signal
  const outcome = (call.outcome || '').toUpperCase();
  
  return hasBookingPhrase || outcome === 'BOOKED';
}

/** Get next step: explicit action text with actor (Agent/Caller). Returns null if no callback. */
export function getNextStep(call: CallData): string | null {
  if (isNoActionNeeded(call)) return null;
  if (call.nextStep && call.nextStep.trim()) {
    return call.nextStep.trim();
  }
  if (!isActionRequired(call)) {
    const rt = (call.recordType || '').toUpperCase();
    if (rt !== 'TICKET' && !call.follow_up_required) return null;
  }
  
  // Check if appointment was just booked - if so, next step is reminder, not confirmation
  if (wasAppointmentJustBooked(call)) {
    return 'Agent needs to send reminder day before appointment';
  }
  
  // Prioritize action_description as it's most explicit
  const actionDesc = call.action_description?.trim() || '';
  const ticketNotes = call.ticket_notes?.trim() || '';
  const callSolution = call.call_solution?.trim() || '';
  
  // Determine who needs to perform the action
  const actor = determineActor(actionDesc, ticketNotes, callSolution);
  
  // Build explicit action text from action_description
  if (actionDesc) {
    // Extract the core action - take first sentence, make it explicit
    const firstSentence = actionDesc.split(/[.!?\n]/)[0]?.trim() || actionDesc;
    const lowerFirst = firstSentence.toLowerCase();
    
    // Common patterns to make explicit (these are always agent actions)
    let actionText = '';
    
    if (lowerFirst.includes('callback') || lowerFirst.includes('call back')) {
      actionText = 'arrange callback from doctor';
      // Callbacks are always agent actions
      return 'Agent needs to arrange callback from doctor';
    } else if (lowerFirst.includes('appointment') || lowerFirst.includes('book')) {
      // Only say "confirm appointment details" if it wasn't just booked
      // (wasAppointmentJustBooked check above handles the booked case)
      actionText = 'confirm appointment details';
    } else if (lowerFirst.includes('prescription') || lowerFirst.includes('medicine')) {
      actionText = 'resend prescription';
    } else if (lowerFirst.includes('report') || lowerFirst.includes('test')) {
      actionText = 'share test report';
    } else if (lowerFirst.includes('charge') || lowerFirst.includes('bill') || lowerFirst.includes('payment')) {
      actionText = 'explain charges';
    } else if (lowerFirst.includes('ambulance')) {
      actionText = 'arrange ambulance service';
    } else if (lowerFirst.includes('approval') || lowerFirst.includes('permission')) {
      actionText = 'get doctor approval';
    } else {
      // Extract main verb and object - look for action verbs
      const actionVerbs = ['confirm', 'arrange', 'verify', 'check', 'coordinate', 'send', 'share', 'explain', 'get', 'schedule', 'resend', 'go', 'visit'];
      for (const verb of actionVerbs) {
        if (lowerFirst.includes(verb)) {
          const verbIndex = lowerFirst.indexOf(verb);
          const afterVerb = firstSentence.substring(verbIndex + verb.length).trim();
          // Take meaningful part (up to comma, period, or reasonable length)
          const keyPart = afterVerb.split(/[.,]/)[0]?.trim() || '';
          // Clean up: remove "to", "the", etc. at start
          const cleanedPart = keyPart.replace(/^(to|the|a|an)\s+/i, '').trim();
          if (cleanedPart.length > 0 && cleanedPart.length < 45) {
            actionText = `${verb} ${cleanedPart}`.toLowerCase();
            break;
          }
        }
      }
      
      // If no pattern matched, extract meaningful words
      if (!actionText) {
        const words = firstSentence.split(/\s+/);
        // Skip common prefixes and stop words
        const skipWords = ['the', 'a', 'an', 'to', 'for', 'with', 'from', 'and', 'or', 'but'];
        const meaningfulWords = words
          .filter(w => {
            const lower = w.toLowerCase();
            return !skipWords.includes(lower) && 
                   !lower.match(/^(agent|caller|patient|customer|needs|should|must|will|has|noted)$/);
          })
          .slice(0, 7);
        if (meaningfulWords.length > 0) {
          actionText = meaningfulWords.join(' ').toLowerCase();
        }
      }
    }
    
    // Clean the action text to remove duplicate prefixes
    const cleanedAction = cleanActionText(actionText || firstSentence, actor);
    
    // Ensure we have valid action text
    if (!cleanedAction || cleanedAction.length < 3) {
      // Fallback: use first meaningful words
      const words = firstSentence.split(/\s+/)
        .filter(w => w.length > 2)
        .slice(0, 6);
      const fallback = words.join(' ').toLowerCase();
      const cleaned = cleanActionText(fallback, actor);
      return cleaned.startsWith(actor.toLowerCase()) ? cleaned : `${actor} needs to ${cleaned}`;
    }
    
    // Check if cleaned text already has actor prefix
    const lowerCleaned = cleanedAction.toLowerCase();
    if (lowerCleaned.startsWith(actor.toLowerCase() + ' needs to')) {
      return cleanedAction;
    }
    
    // Truncate if too long
    let finalAction = cleanedAction;
    if (finalAction.length > 55) {
      const words = finalAction.split(/\s+/);
      finalAction = words.slice(0, 7).join(' ');
    }
    
    return `${actor} needs to ${finalAction}`;
  }
  
  // Fallback to ticket_notes or call_solution
  const fallback = ticketNotes || callSolution;
  if (!fallback) return null;
  
  const first = fallback.split(/[.!?\n]/)[0]?.trim() || fallback;
  const cleaned = cleanActionText(first, actor);
  
  // Extract meaningful words if cleaned is too long or awkward
  if (cleaned.length > 60 || cleaned.toLowerCase().includes('agent needs to agent')) {
    const words = first.split(/\s+/)
      .filter(w => {
        const lower = w.toLowerCase();
        return !['the', 'a', 'an', 'to', 'for', 'with', 'from', 'and', 'agent', 'caller', 'needs', 'should'].includes(lower);
      })
      .slice(0, 6);
    const extracted = words.join(' ').toLowerCase();
    return extracted.startsWith(actor.toLowerCase()) ? extracted : `${actor} needs to ${extracted}`;
  }
  
  return cleaned.startsWith(actor.toLowerCase()) ? cleaned : `${actor} needs to ${cleaned}`;
}

/** Controlled vocabulary for follow-up reasons (Next Action) */
export const FOLLOW_UP_REASONS = [
  'Appointment',
  'Callback',
  'Prescription',
  'Test Report',
  'Discharge',
  'Home Care',
  'Emergency',
  'Billing',
  'Complaint',
  'Enquiry',
  'Ambulance',
  'Unclear',
] as const;

export type FollowUpReason = (typeof FOLLOW_UP_REASONS)[number];

/** Infer follow-up reason from call data. Returns reason + confidence. Use "Unclear" when low confidence. */
export function getFollowUpReason(call: CallData): { reason: FollowUpReason; confidence: 'high' | 'medium' | 'low' } {
  const text = [
    call.notes,
    call.ticket_solution,
    call.ticket_notes,
    call.action_description,
    call.LeadNotes,
    call.call_solution,
    call.call_conclusion,
    call.services,
    call.department,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const classification = (call.call_classification || '').toUpperCase();
  const filename = (call.filename || '').toUpperCase();
  const outcome = (call.outcome || '').toUpperCase();

  const matches: { reason: FollowUpReason; score: number }[] = [];

  // Strong signals from classification
  if (classification.includes('APPOINTMENT')) matches.push({ reason: 'Appointment', score: 3 });
  if (classification.includes('COMPLAINT')) matches.push({ reason: 'Complaint', score: 3 });
  if (classification.includes('ENQUIRY') || classification.includes('INQUIRY')) matches.push({ reason: 'Enquiry', score: 2 });
  if (classification.includes('FOLLOW') || classification.includes('FOLLOWUP')) matches.push({ reason: 'Callback', score: 2 });

  // Strong signals from filename
  if (filename.includes('EMERGENCY')) matches.push({ reason: 'Emergency', score: 2 });
  if (filename.includes('APPOINTMENT')) matches.push({ reason: 'Appointment', score: 2 });
  if (filename.includes('POST_DISCHARGE')) matches.push({ reason: 'Discharge', score: 2 });
  if (filename.includes('HOMECARE') || filename.includes('HOME_CARE')) matches.push({ reason: 'Home Care', score: 2 });

  // Outcome
  if (outcome === 'BOOKED') matches.push({ reason: 'Appointment', score: 3 });

  // Callback is the next action - highest priority when mentioned in action context
  const actionText = [
    call.action_description,
    call.call_solution,
    call.call_conclusion,
    call.ticket_notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/\bcallback\b|\bcall\s*back\b|\bcalled?\s*back\b|assuring\s+a\s+callback|promised\s+callback|callback\s+(from|by|required)/.test(actionText)) {
    matches.push({ reason: 'Callback', score: 4 });
  } else if (/\bcallback\b|\bdoctor.*call\b|\bcall.*doctor\b/.test(text)) {
    matches.push({ reason: 'Callback', score: 2 });
  }

  // Keyword-based inference
  if (/\bappointment\b|\bbook(ed|ing)?\b|\bschedule(d|ing)?\b|\bconfirm(ed|ation)?\b|\bavailability\b/.test(text)) {
    matches.push({ reason: 'Appointment', score: 2 });
  }
  if (/\bprescription\b|\bmedicine\b|\bmedication\b|\brefill\b/.test(text)) {
    matches.push({ reason: 'Prescription', score: 2 });
  }
  if (/\btest\b|\breport\b|\bresult\b|\blab\b|\bmri\b|\bscan\b|\bx-?ray\b/.test(text)) {
    matches.push({ reason: 'Test Report', score: 2 });
  }
  if (/\bdischarge\b|\bpost[- ]?operative\b|\bpost[- ]?op\b|\bsurgery\b|\boperation\b/.test(text)) {
    matches.push({ reason: 'Discharge', score: 2 });
  }
  if (/\bhome\s*care\b|\bpicc\b|\bdressing\b|\bnursing\b/.test(text)) {
    matches.push({ reason: 'Home Care', score: 2 });
  }
  if (/\bemergency\b|\burgent\b|\bambulance\b/.test(text)) {
    matches.push({ reason: 'Emergency', score: 1 });
  }
  if (/\bambulance\b/.test(text)) {
    matches.push({ reason: 'Ambulance', score: 3 });
  }
  if (/\bbill\b|\bcharge(d)?\b|\bpayment\b|\bwrongly\s*charged\b/.test(text)) {
    matches.push({ reason: 'Billing', score: 2 });
  }
  if (/\bcomplaint\b|\bfrustrated\b/.test(text)) {
    matches.push({ reason: 'Complaint', score: 1 });
  }
  if (/\benquir(y|ies)\b|\binquir(y|ies)\b/.test(text)) {
    matches.push({ reason: 'Enquiry', score: 1 });
  }

  // Aggregate and pick best
  const byReason = new Map<FollowUpReason, number>();
  matches.forEach(({ reason, score }) => {
    byReason.set(reason, (byReason.get(reason) || 0) + score);
  });

  const sorted = Array.from(byReason.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([, s]) => s > 0);

  if (sorted.length === 0) {
    return { reason: 'Unclear', confidence: 'low' };
  }

  const [reason, score] = sorted[0];
  if (score < 2) {
    return { reason: 'Unclear', confidence: 'low' };
  }
  const confidence: 'high' | 'medium' | 'low' = score >= 4 ? 'high' : 'medium';
  return { reason, confidence };
}

/** History signals: repeat, past ticket, etc. */
export function getHistorySignals(
  call: CallData,
  phoneCount: number
): { label: string; short: string }[] {
  const signals: { label: string; short: string }[] = [];
  if (phoneCount >= 2) {
    const ord = phoneCount === 2 ? '2nd' : phoneCount === 3 ? '3rd' : `${phoneCount}th`;
    signals.push({ label: `${ord} call from this number`, short: `${phoneCount}x` });
  }
  if ((call as { follow_up_required?: boolean }).follow_up_required) {
    signals.push({ label: 'Has follow-up', short: 'FU' });
  }
  const rt = (call.recordType || '').toUpperCase();
  if (rt === 'TICKET') {
    signals.push({ label: 'Ticket', short: 'Tkt' });
  }
  return signals;
}

/** Top bar: calls breaching SLA in next hour, overdue count */
export function getTimePressureMetrics(
  calls: CallData[],
  now = Date.now()
): { breachIn1h: number; overdue: number; oldestPendingHours: number } {
  const oneHour = 60 * 60 * 1000;
  let breachIn1h = 0;
  let overdue = 0;
  let oldestPendingMs = 0;

  const actionCalls = calls.filter(isActionRequired);

  actionCalls.forEach((call) => {
    const ts = call.timestamp;
    if (!ts) return;
    const category = extractCallCategory(call.filename);
    const limitMs = getSLALimitMs(category);
    const callTime = new Date(ts).getTime();
    const elapsed = now - callTime;
    const msLeft = limitMs - elapsed;

    if (msLeft <= 0) overdue++;
    else if (msLeft <= oneHour) breachIn1h++;

    if (elapsed > oldestPendingMs) oldestPendingMs = elapsed;
  });

  const oldestPendingHours = oldestPendingMs / (60 * 60 * 1000);
  return { breachIn1h, overdue, oldestPendingHours };
}

/** Trend: anxiety %, emergency %, etc. (from current dataset) */
export function getTrendData(calls: CallData[]): {
  anxietyPct: number;
  emergencyCount: number;
  actionPct: number;
} {
  if (calls.length === 0) return { anxietyPct: 0, emergencyCount: 0, actionPct: 0 };
  const anxiety = calls.filter(isHighAnxiety).length;
  const emergency = calls.filter((c) => extractCallCategory(c.filename) === 'EMERGENCY').length;
  const action = calls.filter(isActionRequired).length;
  return {
    anxietyPct: Math.round((anxiety / calls.length) * 100),
    emergencyCount: emergency,
    actionPct: Math.round((action / calls.length) * 100),
  };
}

/** AI insight from data */
export function getAIInsight(calls: CallData[]): string {
  const needsAction = calls.filter(isActionRequired).length;
  const highAnxiety = calls.filter(isHighAnxiety).length;
  const emergency = calls.filter((c) => extractCallCategory(c.filename) === 'EMERGENCY').length;

  if (needsAction >= 3 && highAnxiety >= 2) {
    return 'Multiple anxious callers need action. Prioritize callback requests to reduce escalation risk.';
  }
  if (emergency >= 2) {
    return 'Elevated emergency volume today. Ensure urgent callbacks are completed within 2 hours.';
  }
  if (needsAction >= 2) {
    return 'Several calls require follow-up. Check SLA countdowns to avoid breaches.';
  }
  const categories = calls.map((c) => extractCallCategory(c.filename));
  const appointment = categories.filter((c) => c === 'APPOINTMENT').length;
  if (appointment >= 2 && needsAction > 0) {
    return 'Appointment-related calls may need confirmation. Consider proactive callbacks.';
  }
  return 'Calls look manageable. Focus on any with SLA under 1 hour.';
}

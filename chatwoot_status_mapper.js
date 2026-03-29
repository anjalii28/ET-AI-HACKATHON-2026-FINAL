/**
 * Chatwoot Status Mapping Utility
 * 
 * This file should be placed in: app/javascript/shared/helpers/statusMapper.js
 * 
 * Maps backend statuses to UI labels and vice versa.
 * 
 * Backend → UI Display:
 * - open → in_process
 * - pending → blocked
 * - resolved → finished
 */

// Map backend status to UI display label
export const getStatusDisplayLabel = (backendStatus) => {
  const statusMap = {
    open: 'in_process',
    pending: 'blocked',
    resolved: 'finished',
    snoozed: 'snoozed' // Keep snoozed as-is
  };
  
  return statusMap[backendStatus] || backendStatus;
};

// Map UI display label back to backend status
export const getBackendStatus = (displayLabel) => {
  const reverseMap = {
    in_process: 'open',
    blocked: 'pending',
    finished: 'resolved',
    snoozed: 'snoozed' // Keep snoozed as-is
  };
  
  return reverseMap[displayLabel] || displayLabel;
};

// Get all available statuses for dropdowns (UI labels)
export const getAvailableStatuses = () => {
  return [
    { value: 'open', label: 'in_process' },
    { value: 'pending', label: 'blocked' },
    { value: 'resolved', label: 'finished' },
    { value: 'snoozed', label: 'snoozed' }
  ];
};

// Get status badge color class
export const getStatusBadgeClass = (backendStatus) => {
  const status = backendStatus || '';
  
  if (status === 'open') {
    return 'status-in-process'; // Blue/Orange
  } else if (status === 'pending') {
    return 'status-blocked'; // Red
  } else if (status === 'resolved') {
    return 'status-finished'; // Green
  } else if (status === 'snoozed') {
    return 'status-snoozed';
  }
  
  return 'status-default';
};

// Get status badge text (UI label)
export const getStatusBadgeText = (backendStatus) => {
  return getStatusDisplayLabel(backendStatus);
};

// Helper to map an array of conversations (for list views)
export const mapConversationStatuses = (conversations) => {
  return conversations.map(conv => ({
    ...conv,
    displayStatus: getStatusDisplayLabel(conv.status),
    statusBadgeClass: getStatusBadgeClass(conv.status)
  }));
};

// Helper for filter options (returns both backend value and display label)
export const getStatusFilterOptions = () => {
  return [
    { backendValue: 'open', displayLabel: 'in_process' },
    { backendValue: 'pending', displayLabel: 'blocked' },
    { backendValue: 'resolved', displayLabel: 'finished' },
    { backendValue: 'snoozed', displayLabel: 'snoozed' }
  ];
};

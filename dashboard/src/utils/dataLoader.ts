import { CallData } from '../types';

/**
 * Loads call data from JSON files in the public/data directory.
 * Limited to MAX_CALL_FILES to avoid browser resource errors (ERR_INSUFFICIENT_RESOURCES).
 * TICKET_CONFUSION is normalized to TICKET for display purposes.
 * Calls are sorted by timestamp (latest first).
 */
const MAX_CALL_FILES = 120;
const BATCH_SIZE = 20;
const DATA_BASE = `${import.meta.env.BASE_URL}data`.replace(/\/+/g, '/');
const DATA_BASE_ROOT = '/data';

async function fetchData(path: string): Promise<Response> {
  const url = `${DATA_BASE}/${path}`;
  const res = await fetch(url);
  if (res.ok) return res;
  if (DATA_BASE !== DATA_BASE_ROOT) {
    const fallback = await fetch(`${DATA_BASE_ROOT}/${path}`);
    if (fallback.ok) return fallback;
  }
  return res;
}

export async function loadCallData(): Promise<CallData[]> {
  console.log('Loading call data...');

  try {
    // Load manifest (under app base /app/data/ for nginx; fallback to /data/ for Vite dev)
    const manifestResponse = await fetchData('manifest.json');
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.json();
      console.log(`Manifest loaded: ${manifest.totalFiles || 0} files listed`);
      
      if (Array.isArray(manifest.files)) {
        const filesToLoad = manifest.files.slice(0, MAX_CALL_FILES);
        console.log(`Loading ${filesToLoad.length} file(s) (max ${MAX_CALL_FILES}) of ${manifest.files.length} in manifest...`);

        const loadedCalls: (CallData | null)[] = [];
        for (let i = 0; i < filesToLoad.length; i += BATCH_SIZE) {
          const batch = filesToLoad.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (filename: string) => {
              try {
                const response = await fetchData(filename);
                if (response.ok) {
                  const callData = await response.json();
                  const normalizedRecordType = normalizeRecordType(callData.recordType);
                  return {
                    ...callData,
                    recordType: normalizedRecordType,
                    filename: filename,
                  } as CallData;
                }
              } catch (error) {
                console.warn(`Failed to load ${filename}:`, error);
              }
              return null;
            })
          );
          loadedCalls.push(...batchResults);
        }

        const validCalls = loadedCalls.filter((call): call is CallData => call !== null);
        console.log(`Successfully loaded ${validCalls.length} of ${filesToLoad.length} file(s)`);
        
        // Sort by timestamp (latest first)
        validCalls.sort((a, b) => {
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return timeB - timeA;
        });
        
        console.log(`Final call count: ${validCalls.length}`);
        return validCalls;
      }
    }
  } catch (error) {
    console.warn('Could not load manifest.json:', error);
    console.warn('   Trying fallback...');
  }

  // Fallback: Try loading single consolidated file (only if manifest failed)
  console.warn('Manifest not found, trying fallback...');
  try {
    const singleFileResponse = await fetchData('calls.json');
    if (singleFileResponse.ok) {
      const data = await singleFileResponse.json();
      const callArray = Array.isArray(data) ? data : [data];
      console.log(`Using fallback calls.json with ${callArray.length} call(s)`);
      // Normalize and add filename
      return callArray.map((call, index) => ({
        ...call,
        recordType: normalizeRecordType(call.recordType),
        filename: call.filename || `call_${index + 1}.json`,
      }));
    }
  } catch (error) {
    console.warn(`Could not load ${DATA_BASE}/calls.json`);
  }

  // Return empty array if no data found
  console.error('No call data found. Run "npm run load-data" to load files from output folder.');
  return [];
}

/**
 * Normalizes recordType: TICKET_CONFUSION becomes TICKET
 */
function normalizeRecordType(recordType?: string): CallData['recordType'] {
  if (!recordType) return undefined;
  const upper = recordType.toUpperCase();
  if (upper === 'TICKET_CONFUSION' || upper === 'CONFUSION') {
    return 'TICKET';
  }
  return upper as CallData['recordType'];
}

export function calculateStats(calls: CallData[]): {
  total: number;
  lead: number;
  ticket: number;
} {
  const stats = {
    total: calls.length,
    lead: 0,
    ticket: 0,
  };

  calls.forEach((call) => {
    const recordType = call.recordType?.toUpperCase();
    if (recordType === 'LEAD') {
      stats.lead++;
    } else if (recordType === 'TICKET' || recordType === 'TICKET_CONFUSION' || recordType === 'CONFUSION') {
      stats.ticket++;
    }
  });

  return stats;
}

function isActionRequired(call: CallData): boolean {
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

function isHighAnxiety(call: CallData): boolean {
  // Use customer sentiment (with backward compatibility)
  const s = ((call.customer_sentiment_label || call.sentiment_label) || '').toUpperCase();
  return s.includes('ANXIOUS') || s.includes('NEGATIVE') || s.includes('FRUSTRATED') || s.includes('ANGRY');
}

export function calculateInsights(calls: CallData[]): {
  total: number;
  lead: number;
  ticket: number;
  needsAction: number;
  highAnxiety: number;
  repeatCallers: number;
} {
  const stats = calculateStats(calls);
  let needsAction = 0;
  let highAnxiety = 0;
  const phoneCounts = new Map<string, number>();

  calls.forEach((call) => {
    if (isActionRequired(call)) needsAction++;
    if (isHighAnxiety(call)) highAnxiety++;
    const phone = call.phone_number?.trim();
    if (phone) {
      phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
    }
  });

  const repeatCallers = Array.from(phoneCounts.values()).filter((c) => c >= 2).length;

  return {
    ...stats,
    needsAction,
    highAnxiety,
    repeatCallers,
  };
}

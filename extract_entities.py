import os
import json
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from datetime import datetime

# Load environment variables
load_dotenv()

# Configuration: one output folder for all JSON files (relative to script location)
_SCRIPT_DIR = Path(__file__).resolve().parent
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
AUDIO_DIR = _SCRIPT_DIR / "audio"
OUTPUT_DIR = _SCRIPT_DIR / "output"  # only place JSON files are saved

if not GEMINI_API_KEY:
    print("ERROR: GEMINI_API_KEY not found in .env file or environment variables.")
    print("   Please add GEMINI_API_KEY to your .env file")
    raise ValueError("GEMINI_API_KEY not found")

# Initialize Gemini API client
client = genai.Client(api_key=GEMINI_API_KEY)

# Create output directory if it doesn't exist
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def extract_timestamp_from_filename(filename):
    """Extract timestamp from filename if available."""
    # Try to extract timestamp from filename patterns
    # Example: in_8867065830_Sparsh_Emergency_Muthumari_1012_inbound_20251203134613.WAV
    import re
    # Look for YYYYMMDDHHMMSS pattern right before file extension (most reliable)
    # Pattern: 14 digits followed by .WAV/.wav/.mp3 etc.
    match = re.search(r'(\d{14})\.(WAV|wav|mp3|MP3)', filename)
    if match:
        ts_str = match.group(1)
        try:
            # Parse: YYYYMMDDHHMMSS
            dt = datetime.strptime(ts_str, "%Y%m%d%H%M%S")
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception as e:
            print(f"  WARNING: Could not parse timestamp '{ts_str}' from filename: {e}")
    # Fallback: look for any 14-digit pattern
    match = re.search(r'(\d{14})', filename)
    if match:
        ts_str = match.group(1)
        try:
            # Parse: YYYYMMDDHHMMSS
            dt = datetime.strptime(ts_str, "%Y%m%d%H%M%S")
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception as e:
            print(f"  WARNING: Could not parse timestamp '{ts_str}' from filename: {e}")
    # Default to current timestamp
    print(f"  WARNING: No valid timestamp found in filename '{filename}', using current time")
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def process_audio_file(audio_path):
    """Process a single audio file with Gemini API and extract entities."""
    print(f"\nProcessing: {audio_path.name}")
    
    audio_file = None
    response_text = None
    
    try:
        # Upload audio file
        print("  Uploading audio file...")
        audio_file = client.files.upload(file=str(audio_path))
        
        # Create prompt for entity extraction
        prompt = """Analyze this audio call transcript and classify it STRICTLY using the rules below. Then extract the requested information in JSON format.

=== CLASSIFICATION RULES (apply strictly) ===

MAIN CATEGORY — Choose only one: LEAD or TICKET

LEAD (Pre-visit / Pre-conversion)
Mark as LEAD if ANY of the following are true:
- Booking a new appointment → Lead – Appointment
- Enquiry about availability, timings, doctors → Lead – Enquiry
- Asking about services, procedures, or costs → Lead – Enquiry
- First-time contact for a patient
- Walk-in intent
- Phrases like: "Can I book…", "Is doctor X available…", "Do you provide…"
- Patient has not yet received any care
- Think: before visit, before conversion

TICKET (Support / Post-interaction)
Mark as TICKET if the call is about something that already exists. Use TICKET if ANY of the following are true:
- Existing appointment issues (reschedule, delay, confusion) → Ticket – Appointment
- Follow-up after consultation → Ticket – Follow-up
- Test results discussion → Ticket – Discussion
- Post-visit complaints or clarifications → Ticket – Complaint
- Prescription or medication doubts → Ticket – Follow-up
- Billing issues → Ticket – Enquiry
- Doctor already consulted
- Phrases like: "I already visited…", "I had an appointment…", "I was told to…"
- Agent action needed (callback, escalation, coordination)
- Questions about lab reports → Ticket – Enquiry (if lab reports missing, assign to appropriate department)

=== OUTPUT (valid JSON only) ===

Return exactly these fields in this order. No other fields.

{
  "source_type": "call",
  "recordType": "lead" or "ticket",
  "call_classification": "Appointment" or "Enquiry" or "Complaint" or "Service Required" or "Follow-up" or "Discussion",
  "action_required": "Yes" or "No",
  "action_description": "If action_required is Yes, one line describing what action is needed. If No, set to null.",
  "department_to_handle": "Department name (e.g. General OPD, Billing, Lab, Cardiology)",
  "priority": "Low" or "Medium" or "High" or "Emergency",
  "ticket_notes": "Brief summary (2-3 lines). MUST be null when recordType is lead.",
  "LeadNotes": "Notes for lead (2-3 lines). MUST be null when recordType is ticket.",
  "call_solution": "How the call was resolved (2-3 lines max)",
  "transcript": "A comprehensive narrative summary of the entire call written in long-form passive voice. Describe what the caller said and what the agent said throughout the conversation. Write it as a flowing narrative (e.g., 'The caller mentioned that...', 'The agent explained that...', 'The caller then asked about...', 'The agent responded by...'). Include all substantive dialogue and key points from the conversation, but present it as a cohesive summary narrative rather than direct quotes or speaker labels.",
  "customer_name": "Name of the caller or null",
  "phone_number": "Phone number or null",
  "location": "Location or null",
  "department": "Department if mentioned or null",
  "services": "Services inquired about or null",
  "follow_up_required": true or false,
  "hospital_name": "Hospital name or null",
  "doctor_name": "Doctor name or null",
  "customer_sentiment_label": "POSITIVE" or "NEUTRAL" or "NEGATIVE" or "ANXIOUS" or "FRUSTRATED",
  "customer_sentiment_summary": "Brief customer sentiment in one line",
  "agent_sentiment_label": "POSITIVE" or "NEUTRAL" or "NEGATIVE" or "ANXIOUS" or "FRUSTRATED" or "PROFESSIONAL" or "HELPFUL",
  "agent_sentiment_summary": "Brief agent sentiment/tone in one line (how the agent talked to the customer)",
  "outcome": "ONE WORD ONLY from this list: CALLBACK, BOOKED, RESCHEDULED, INFORMATION CALL, FOLLOWUP, NOANSWER, DROPPED, ESCALATED, RESOLVED, CANCELLED, UNKNOWN"
}

=== OUTCOME RULES (one word only) ===
- outcome: Select the value that best represents the final action or state of the call.
- If multiple things happened, choose the last decisive action.
- If the call ended without a clear action, return INFORMATION CALL.
- If the call requires another action in the future, return FOLLOWUP.
- If no clear signal is present, return UNKNOWN.
- Output must be exactly one value from the allowed list above.

CRITICAL rules:
- recordType: only lowercase "lead" or "ticket".
- call_classification: only one of Appointment, Enquiry, Complaint, Service Required, Follow-up, Discussion.
- For lead: ticket_notes must be null; use LeadNotes for the summary.
- For ticket: LeadNotes must be null; use ticket_notes for the summary.
- action_required: only "Yes" or "No". When "Yes", action_description must be one line; when "No", action_description must be null.
- Do NOT include follow_ups, main_category, subcategory, or timestamp.
- transcript: MUST be a comprehensive narrative summary written in long-form passive voice, describing what the caller said and what the agent said throughout the conversation. Write as a flowing narrative (e.g., "The caller mentioned that...", "The agent explained that..."). Include all substantive dialogue and key points, but present as a cohesive summary narrative rather than direct quotes or speaker labels.
- Return ONLY valid JSON.
"""

        # Generate response using gemini-2.5-flash
        print("  Sending to Gemini API...")
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[prompt, audio_file]
        )
        
        # Parse JSON from response
        if not hasattr(response, 'text') or not response.text:
            print("  ERROR: No text response from API")
            return None
            
        response_text = response.text.strip()
        
        # Remove markdown code blocks if present
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        # Parse JSON
        extracted_data = json.loads(response_text)
        
        # Normalize recordType to lowercase (lead/ticket only)
        rt_raw = extracted_data.get("recordType")
        if rt_raw:
            r = str(rt_raw).strip().lower()
            if "lead" in r or r == "l":
                extracted_data["recordType"] = "lead"
            elif "ticket" in r or r == "t":
                extracted_data["recordType"] = "ticket"
        rt = extracted_data.get("recordType", "")
        # Enforce: ticket_notes empty for leads, LeadNotes empty for tickets
        if rt == "lead":
            extracted_data["ticket_notes"] = None
        elif rt == "ticket":
            extracted_data["LeadNotes"] = None
        # Normalize action_required to Yes/No
        ar = extracted_data.get("action_required")
        if ar is not None:
            ar_str = str(ar).strip().upper()
            if ar_str in ("YES", "Y", "TRUE", "ACTION_REQUIRED", "FOLLOW_UP", "REQUIRED"):
                extracted_data["action_required"] = "Yes"
                if not extracted_data.get("action_description"):
                    extracted_data["action_description"] = extracted_data.get("call_solution") or None
            else:
                extracted_data["action_required"] = "No"
                extracted_data["action_description"] = None
        # Ensure action_description when action_required is Yes
        if extracted_data.get("action_required") == "Yes" and not extracted_data.get("action_description"):
            extracted_data["action_description"] = extracted_data.get("call_solution") or "Action needed."
        # Remove obsolete fields
        for key in ("main_category", "subcategory", "follow_ups"):
            extracted_data.pop(key, None)
        
        # Always extract timestamp from filename (filename is the source of truth)
        # Remove any timestamp Gemini might have provided
        filename_timestamp = extract_timestamp_from_filename(audio_path.name)
        extracted_data["timestamp"] = filename_timestamp
        print(f"  Extracted timestamp from filename: {filename_timestamp}")
        
        # Ensure source_type is set
        if not extracted_data.get("source_type"):
            extracted_data["source_type"] = "call"
        # Ensure action_description exists (null when action_required is No)
        if extracted_data.get("action_required") != "Yes":
            extracted_data["action_description"] = None
        # Output order: source_type first, then rest in consistent order
        _outcome_allowed = frozenset({
            "CALLBACK", "BOOKED", "RESCHEDULED", "INFORMATION CALL", "FOLLOWUP",
            "NOANSWER", "DROPPED", "ESCALATED", "RESOLVED", "CANCELLED", "UNKNOWN"
        })
        raw_outcome = extracted_data.get("outcome")
        if raw_outcome is not None and str(raw_outcome).strip():
            normalized = str(raw_outcome).strip().upper()
            if normalized in _outcome_allowed:
                extracted_data["outcome"] = normalized
            else:
                extracted_data["outcome"] = "UNKNOWN"
        else:
            extracted_data["outcome"] = "UNKNOWN"
        key_order = (
            "source_type", "recordType", "call_classification", "action_required", "action_description",
            "department_to_handle", "priority", "ticket_notes", "LeadNotes", "call_solution", "transcript",
            "customer_name", "phone_number", "location", "department", "services", "follow_up_required",
            "hospital_name", "doctor_name", "customer_sentiment_label", "customer_sentiment_summary", 
            "agent_sentiment_label", "agent_sentiment_summary", "outcome", "timestamp"
        )
        ordered = {k: extracted_data[k] for k in key_order if k in extracted_data}
        for k, v in extracted_data.items():
            if k not in ordered:
                ordered[k] = v
        print(f"  Successfully extracted entities")
        return ordered
        
    except json.JSONDecodeError as e:
        print(f"  ERROR: Error parsing JSON response: {e}")
        if response_text:
            print(f"  Response text: {response_text[:500]}")
        return None
    except Exception as e:
        print(f"  ERROR: Error processing file: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        # Clean up uploaded file
        try:
            if audio_file and hasattr(audio_file, 'name'):
                client.files.delete(name=audio_file.name)
        except Exception as cleanup_error:
            print(f"  WARNING: Could not delete uploaded file: {cleanup_error}")
            pass

def main():
    print("Entity Extraction Script")
    print("=" * 50)
    print(f"Audio directory: {AUDIO_DIR.resolve()}")
    print(f"Output directory: {OUTPUT_DIR.resolve()}")
    print("=" * 50)
    
    # Check if audio directory exists
    if not AUDIO_DIR.exists():
        print(f"ERROR: Audio directory '{AUDIO_DIR}' not found!")
        print(f"   Please create the '{AUDIO_DIR}' folder and add your audio files there.")
        return
    
    # Find all audio files
    audio_files = list(AUDIO_DIR.glob("*.wav")) + \
                  list(AUDIO_DIR.glob("*.WAV")) + \
                  list(AUDIO_DIR.glob("*.mp3")) + \
                  list(AUDIO_DIR.glob("*.MP3"))
    
    if not audio_files:
        print(f"WARNING: No audio files found in {AUDIO_DIR}/")
        print("   Supported formats: .wav, .mp3")
        return
    
    print(f"\nFound {len(audio_files)} audio file(s) to process\n")
    
    success_count = 0
    failed_count = 0
    
    for audio_file in audio_files:
        # Process audio file
        extracted_data = process_audio_file(audio_file)
        
        if extracted_data:
            # Save to JSON file
            output_filename = audio_file.stem + ".json"
            output_path = OUTPUT_DIR / output_filename
            
            try:
                with open(output_path, "w", encoding="utf-8") as f:
                    json.dump(extracted_data, f, indent=2, ensure_ascii=False)
                print(f"  Saved to: {output_path}")
                success_count += 1
            except Exception as e:
                print(f"  ERROR: Error saving file: {e}")
                failed_count += 1
        else:
            failed_count += 1
    
    print("\n" + "=" * 50)
    print("Processing complete!")
    print(f"   Successfully processed: {success_count}")
    print(f"   Failed: {failed_count}")
    print(f"   JSON files saved in: {OUTPUT_DIR.resolve()}/")
    print("=" * 50)

if __name__ == "__main__":
    main()

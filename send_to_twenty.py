import os
import json
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Twenty CRM Configuration
TWENTY_API_URL = os.environ.get("TWENTY_API_URL", "http://localhost:3000/rest")
TWENTY_API_KEY = os.environ.get("TWENTY_API_KEY")

if not TWENTY_API_KEY:
    print("WARNING: TWENTY_API_KEY not found in .env file or environment variables.")
    print("   Please create a .env file with your API key:")
    print("   1. Copy .env.example to .env")
    print("   2. Add your TWENTY_API_KEY to .env")
    print("\n   Or set it as an environment variable:")
    print("   export TWENTY_API_KEY='your-api-key-here'")
    raise ValueError("TWENTY_API_KEY not found. Please check your .env file or environment variables.")

OUTPUT_DIR = "output"

# Department enum mapping
DEPARTMENT_ENUM = {
    "CARDIOLOGY": ["cardiology", "cardiac", "heart"],
    "ORTHOPEDICS": ["orthopedics", "orthopedic", "bone", "fracture"],
    "NEUROLOGY": ["neurology", "neurological", "brain", "nerve"],
    "GENERAL": ["general", "opd", "outpatient"]
}

def normalize_department(dept_text):
    """Normalize department to enum value. Returns None if no department found."""
    if not dept_text:
        return None
    
    dept_lower = str(dept_text).lower()
    # Check for invalid values
    if dept_lower in ["nan", "null", "none", ""]:
        return None
    
    for enum_val, keywords in DEPARTMENT_ENUM.items():
        if any(keyword in dept_lower for keyword in keywords):
            return enum_val
    return None

def normalize_string_for_crm(value):
    """Normalize string values for CRM: convert empty/null values to 'Not available'."""
    if value is None:
        return "Not available"
    if isinstance(value, str):
        value = value.strip()
        if not value or value.lower() in ["nan", "null", "none", ""]:
            return "Not available"
        return value
    return str(value).strip() if value else "Not available"

def enforce_twenty_not_nulls(payload):
    """
    Final boundary enforcement for Twenty CRM.
    Ensures all NOT NULL columns have safe values.
    """

    # name (mandatory)
    name_value = payload.get("name")
    if not name_value or (isinstance(name_value, str) and name_value.strip() == ""):
        record_type = payload.get("recordType")
        if record_type == "TICKET":
            payload["name"] = "Ticket from Call"
        elif record_type == "LEAD":
            payload["name"] = "Lead from Call"
        else:
            payload["name"] = "Unknown Record"

    # notes (mandatory)
    notes_value = payload.get("notes")
    if not notes_value or (isinstance(notes_value, str) and notes_value.strip() == ""):
        record_type = payload.get("recordType")
        if record_type == "TICKET":
            payload["notes"] = "Ticket created from call. Details available in call report."
        else:
            payload["notes"] = "Lead created from call."

    # department (mandatory)
    dept_value = payload.get("department")
    if not dept_value or (isinstance(dept_value, str) and dept_value.strip() == ""):
        payload["department"] = "GENERAL"

    # leadSource (almost always mandatory)
    lead_source_value = payload.get("leadSource")
    if not lead_source_value or (isinstance(lead_source_value, str) and lead_source_value.strip() == ""):
        payload["leadSource"] = "CALL"

    # recordType (mandatory)
    record_type_value = payload.get("recordType")
    if not record_type_value or (isinstance(record_type_value, str) and record_type_value.strip() == ""):
        payload["recordType"] = "TICKET"
    
    # Ensure string fields use "Not available" instead of None or empty
    if payload.get("location") is None or (isinstance(payload.get("location"), str) and payload.get("location").strip() == ""):
        payload["location"] = "Not available"
    
    if payload.get("doctor") is None or (isinstance(payload.get("doctor"), str) and payload.get("doctor").strip() == ""):
        payload["doctor"] = "Not available"
    
    if payload.get("time") is None or (isinstance(payload.get("time"), str) and payload.get("time").strip() == ""):
        payload["time"] = "Not available"

    return payload

def transform_extended_to_crm_schema(extended_data, filename):
    """Transform extended output JSON to Twenty CRM schema."""
    
    # Map fields from extended output to CRM schema
    name = extended_data.get("customer_name")
    name = normalize_string_for_crm(name) if name else None
    
    phone_number = extended_data.get("phone_number")
    # Parse phone number - extract digits only
    if phone_number:
        import re
        digits = re.sub(r'\D', '', str(phone_number))
        phone_number = digits if digits and digits != "0" else None
    
    location = extended_data.get("location")
    location = normalize_string_for_crm(location)
    
    # Normalize department
    dept = extended_data.get("department")
    department = normalize_department(dept) if dept else None
    department = normalize_string_for_crm(department) if department else None
    
    # Get recordType
    record_type = extended_data.get("recordType", "LEAD")
    
    # Get notes based on recordType
    # TICKET uses ticket_notes, LEAD uses LeadNotes
    if record_type == "TICKET":
        notes = extended_data.get("ticket_notes")
    else:
        notes = extended_data.get("LeadNotes")
    notes = normalize_string_for_crm(notes) if notes else None
    
    # Get doctor name
    doctor = extended_data.get("doctor_name")
    doctor = normalize_string_for_crm(doctor)
    
    # Get appointment time (from services or other fields if available)
    time_str = "Not available"  # Default since extended output doesn't have appointment_time directly
    
    # Get timestamp
    timestamp = extended_data.get("timestamp")
    
    # Get followuprequired
    follow_up_required = extended_data.get("follow_up_required")
    if follow_up_required is True:
        followuprequired = True
    elif follow_up_required is False:
        followuprequired = False
    else:
        followuprequired = None
    
    # Determine leadSource from source_type
    source_type = extended_data.get("source_type", "call")
    lead_source = source_type.upper() if source_type else "CALL"
    if lead_source == "CALL":
        lead_source = "CALL"
    elif lead_source == "PRESCRIPTION":
        lead_source = "PRESCRIPTION"
    else:
        lead_source = "CALL"
    
    # Build CRM schema
    crm_payload = {
        "name": name,
        "leadSource": lead_source,
        "recordType": record_type,
        "department": department,
        "followuprequired": followuprequired,
        "timestamp": timestamp,
        "location": location,
        "notes": notes,
        "doctor": doctor,
        "time": time_str
    }
    
    # Only include phoneNumber if it exists (omit if missing)
    if phone_number:
        crm_payload["phoneNumber"] = phone_number
    
    # Final boundary enforcement for Twenty CRM
    crm_payload = enforce_twenty_not_nulls(crm_payload)
    
    return crm_payload

def send_to_twenty_crm(payload):
    """Send payload to Twenty CRM API."""
    headers = {
        "Authorization": f"Bearer {TWENTY_API_KEY}",
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(
            f"{TWENTY_API_URL}/leads",
            json=payload,
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"API Error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   Status Code: {e.response.status_code}")
            print(f"   Response: {e.response.text}")
            print(f"   Payload sent: {json.dumps(payload, indent=2)}")
        else:
            print(f"   Payload that failed: {json.dumps(payload, indent=2)}")
        return None

# Main processing loop
print("Twenty CRM Upload Script")
print("=" * 50)
print("This script reads JSON files from the output folder")
print("and sends them to Twenty CRM.")
print("=" * 50)
print(f"Using Twenty API URL: {TWENTY_API_URL}")
print(f"API Key configured: {'Yes' if TWENTY_API_KEY else 'No'}\n")

if not os.path.exists(OUTPUT_DIR):
    print(f"ERROR: Output directory '{OUTPUT_DIR}' not found!")
    print("   Please run extract_entities.py first to generate JSON files.")
    exit(1)

json_files = list(Path(OUTPUT_DIR).glob("*.json"))

if not json_files:
    print(f"WARNING: No JSON files found in {OUTPUT_DIR}/")
    print("   Please run extract_entities.py first to generate JSON files.")
    exit(0)

print(f"Found {len(json_files)} JSON file(s) to process\n")

success_count = 0
failed_count = 0

for json_file in json_files:
    filename = json_file.name
    print(f"\nProcessing: {filename}")
    
    try:
        # Read extended output JSON
        with open(json_file, "r") as f:
            extended_data = json.load(f)
        
        # Transform to CRM schema
        crm_payload = transform_extended_to_crm_schema(extended_data, filename)
        
        # Print CRM payload for debugging
        print(f"CRM Payload:")
        print(json.dumps(crm_payload, indent=2))
        
        # Send to Twenty CRM
        print(f"Sending to Twenty CRM...")
        result = send_to_twenty_crm(crm_payload)
        
        if result:
            print(f"Successfully sent to Twenty CRM")
            print(f"   Response: {json.dumps(result, indent=2)}")
            success_count += 1
        else:
            print(f"Failed to send to Twenty CRM (check logs above)")
            failed_count += 1
            
    except Exception as e:
        print(f"Error processing {filename}: {e}")
        failed_count += 1
        continue

print("\n" + "=" * 50)
print("Processing complete!")
print(f"   Successfully sent: {success_count}")
print(f"   Failed: {failed_count}")
print("=" * 50)

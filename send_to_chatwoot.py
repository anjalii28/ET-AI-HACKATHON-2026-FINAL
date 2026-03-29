#!/usr/bin/env python3
"""
Chatwoot Ticket Ingestion Script

This script reads TICKET JSON files from the output directory and creates
conversations (tickets) in Chatwoot.

IMPORTANT: Only processes records where recordType == "ticket"
"""

import os
import json
import requests
from pathlib import Path
from dotenv import load_dotenv
from typing import Dict, Optional, List

# Load environment variables
load_dotenv()

# Chatwoot Configuration
# Default to hosted instance, but can override with localhost for local setup
CHATWOOT_API_URL = os.environ.get("CHATWOOT_API_URL", "https://app.chatwoot.com/api/v1")
CHATWOOT_API_TOKEN = os.environ.get("CHATWOOT_API_TOKEN")
CHATWOOT_ACCOUNT_ID = os.environ.get("CHATWOOT_ACCOUNT_ID")
CHATWOOT_INBOX_ID = os.environ.get("CHATWOOT_INBOX_ID")

if not CHATWOOT_API_TOKEN:
    print("ERROR: CHATWOOT_API_TOKEN not found in environment variables.")
    print("   Please set it in your .env file or export it:")
    print("   export CHATWOOT_API_TOKEN='your-api-token-here'")
    raise ValueError("CHATWOOT_API_TOKEN is required")

if not CHATWOOT_ACCOUNT_ID:
    print("ERROR: CHATWOOT_ACCOUNT_ID not found in environment variables.")
    print("   Please set it in your .env file or export it:")
    print("   export CHATWOOT_ACCOUNT_ID='your-account-id'")
    raise ValueError("CHATWOOT_ACCOUNT_ID is required")

if not CHATWOOT_INBOX_ID:
    print("ERROR: CHATWOOT_INBOX_ID not found in environment variables.")
    print("   Please set it in your .env file or export it:")
    print("   export CHATWOOT_INBOX_ID='your-inbox-id'")
    raise ValueError("CHATWOOT_INBOX_ID is required")

OUTPUT_DIR = "output"


def normalize_phone_to_e164(phone: Optional[str], default_country_code: str = "+91") -> Optional[str]:
    """
    Normalize phone number to E.164 format required by Chatwoot.
    E.164 format: +[country code][number] (e.g., +919876543210)
    
    Args:
        phone: Phone number string (may contain spaces, dashes, etc.)
        default_country_code: Default country code if not present (default: +91 for India)
    
    Returns:
        Normalized phone number in E.164 format, or None if invalid
    """
    if not phone:
        return None
    
    # Remove all non-digit characters except +
    cleaned = ''.join(c for c in str(phone).strip() if c.isdigit() or c == '+')
    
    if not cleaned:
        return None
    
    # If it already starts with +, check if valid
    if cleaned.startswith('+'):
        # Remove + to count digits
        digits = cleaned[1:]
        if len(digits) >= 10:  # Minimum valid phone number length
            return cleaned
        else:
            # Invalid format, try to fix
            return None
    
    # If it starts with country code digits (like 91 for India)
    if cleaned.startswith('91') and len(cleaned) >= 12:
        return '+' + cleaned
    
    # If it's a 10-digit number, assume it's Indian and add +91
    if len(cleaned) == 10 and cleaned.isdigit():
        return default_country_code + cleaned
    
    # If it's longer than 10 digits, try adding +
    if len(cleaned) >= 10:
        # Check if it might already have country code
        if cleaned.startswith('91') and len(cleaned) == 12:
            return '+' + cleaned
        elif len(cleaned) == 10:
            return default_country_code + cleaned
        else:
            # Try to add + and see if it makes sense
            return '+' + cleaned
    
    # If we can't normalize it, return None
    return None


def verify_account_and_inbox(account_id: str, inbox_id: str, api_token: str) -> bool:
    """Verify that the account and inbox exist and are accessible."""
    headers = {
        "api_access_token": api_token,
        "Content-Type": "application/json"
    }
    
    # First verify account exists
    try:
        account_response = requests.get(
            f"{CHATWOOT_API_URL}/accounts/{account_id}",
            headers=headers,
            timeout=10
        )
        if account_response.status_code != 200:
            print(f"   ERROR: Account {account_id} not found or not accessible (Status: {account_response.status_code})")
            if account_response.status_code == 404:
                print(f"   → Check that account_id is correct")
            elif account_response.status_code == 401 or account_response.status_code == 403:
                print(f"   → Check that API token has proper permissions")
            return False
    except Exception as e:
        print(f"   Warning: Could not verify account: {e}")
        return False
    
    # Then verify inbox exists
    try:
        inbox_response = requests.get(
            f"{CHATWOOT_API_URL}/accounts/{account_id}/inboxes/{inbox_id}",
            headers=headers,
            timeout=10
        )
        if inbox_response.status_code == 200:
            inbox_data = inbox_response.json()
            inbox_name = inbox_data.get('name', 'Unknown')
            inbox_type = inbox_data.get('channel_type', 'unknown')
            print(f"   Verified inbox: {inbox_name} (Type: {inbox_type}, ID: {inbox_id})")
            if inbox_type != 'api':
                print(f"   Warning: Inbox type is '{inbox_type}', not 'api'. This may cause issues.")
            return True
        else:
            print(f"   ERROR: Inbox {inbox_id} not found (Status: {inbox_response.status_code})")
            if inbox_response.status_code == 404:
                print(f"   → Check that inbox_id is correct")
                print(f"   → Verify inbox exists at: {CHATWOOT_API_URL.replace('/api/v1', '')}/app/accounts/{account_id}/settings/inboxes")
            return False
    except Exception as e:
        print(f"   Warning: Could not verify inbox: {e}")
        return False


def normalize_priority(priority: Optional[str]) -> str:
    """Normalize priority to Chatwoot format (low, medium, high, urgent)."""
    if not priority:
        return "low"
    
    priority_lower = str(priority).lower().strip()
    if priority_lower in ["emergency", "urgent"]:
        return "urgent"
    elif priority_lower == "high":
        return "high"
    elif priority_lower == "medium":
        return "medium"
    else:
        return "low"


def create_contact(account_id: str, api_token: str, name: Optional[str], phone: Optional[str], email: Optional[str] = None) -> Optional[Dict]:
    """
    Create or find a contact in Chatwoot.
    Returns dict with 'id' and 'source_id' if successful.
    """
    headers = {
        "api_access_token": api_token,
        "Content-Type": "application/json"
    }
    
    # Normalize phone number to E.164 format if provided
    normalized_phone = None
    if phone:
        normalized_phone = normalize_phone_to_e164(phone)
        if not normalized_phone:
            print(f"   Warning: Could not normalize phone number '{phone}' to E.164 format, using as-is")
            normalized_phone = phone  # Fallback to original
    
    # Use phone number as identifier if available, otherwise generate identifier
    # For consistency, use phone > email > name-based identifier
    identifier = normalized_phone if normalized_phone else (email if email else f"call-{name or 'unknown'}")
    
    # Try multiple search methods to find existing contact
    # Method 1: Search by query string
    search_url = f"{CHATWOOT_API_URL}/accounts/{account_id}/contacts/search"
    
    # Try searching by phone number first (use normalized phone)
    if normalized_phone:
        try:
            search_params = {"q": normalized_phone}
            response = requests.get(search_url, headers=headers, params=search_params, timeout=10)
            if response.status_code == 200:
                contacts = response.json()
                if contacts and len(contacts) > 0:
                    contact = contacts[0]
                    contact_id = contact.get("id")
                    if contact_id:
                        return {
                            "id": contact_id,
                            "source_id": contact.get("source_id") or contact.get("identifier") or identifier
                        }
        except Exception:
            pass
    
    # Try searching by identifier
    try:
        search_params = {"q": identifier}
        response = requests.get(search_url, headers=headers, params=search_params, timeout=10)
        if response.status_code == 200:
            contacts = response.json()
            if contacts and len(contacts) > 0:
                contact = contacts[0]
                contact_id = contact.get("id")
                if contact_id:
                    return {
                        "id": contact_id,
                        "source_id": contact.get("source_id") or contact.get("identifier") or identifier
                    }
    except Exception:
        pass
    
    # Method 2: Try using contact filter API (more reliable)
    if normalized_phone:
        try:
            filter_url = f"{CHATWOOT_API_URL}/accounts/{account_id}/contacts/filter"
            filter_data = {"payload": [{"attribute_key": "phone_number", "filter_operator": "equal", "values": [normalized_phone]}]}
            response = requests.post(filter_url, json=filter_data, headers=headers, timeout=10)
            if response.status_code == 200:
                result = response.json()
                contacts = result.get("payload", [])
                if contacts and len(contacts) > 0:
                    contact = contacts[0]
                    contact_id = contact.get("id")
                    if contact_id:
                        return {
                            "id": contact_id,
                            "source_id": contact.get("source_id") or contact.get("identifier") or identifier
                        }
        except Exception:
            pass
    
    # Create new contact
    contact_data = {
        "name": name or "Call Customer",
        "identifier": identifier
    }
    
    # Use normalized phone number (E.164 format)
    if normalized_phone:
        contact_data["phone_number"] = normalized_phone
    elif phone:
        # If normalization failed but we have original phone, try it anyway
        contact_data["phone_number"] = phone
        print(f"   Warning: Using unnormalized phone number '{phone}' - may cause errors")
    
    if email:
        contact_data["email"] = email
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{account_id}/contacts",
            json=contact_data,
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        contact_response = response.json()
        contact_id = contact_response.get("id")
        if not contact_id:
            print(f"   Error: Contact creation response missing 'id' field")
            print(f"   Response: {contact_response}")
            return None
        return {
            "id": contact_id,
            "source_id": contact_response.get("source_id") or contact_response.get("identifier") or identifier
        }
    except requests.exceptions.HTTPError as e:
        # If contact already exists (identifier taken), try to fetch it
        if hasattr(e, 'response') and e.response is not None:
            error_text = e.response.text
            error_data = {}
            try:
                error_data = e.response.json() if error_text else {}
            except:
                pass
            
            error_msg = str(error_data.get("message", "")).lower() if error_data else ""
            if "identifier" in error_msg and ("already" in error_msg or "taken" in error_msg):
                # Contact exists but search didn't find it - try multiple methods to fetch it
                print(f"   Contact identifier exists, fetching existing contact...")
                
                # Method 1: Try search again with different query
                if phone:
                    try:
                        search_params = {"q": normalized_phone if normalized_phone else phone}
                        response = requests.get(search_url, headers=headers, params=search_params, timeout=10)
                        if response.status_code == 200:
                            contacts = response.json()
                            if contacts and len(contacts) > 0:
                                contact = contacts[0]
                                contact_id = contact.get("id")
                                if contact_id:
                                    print(f"   Found existing contact by phone")
                                    return {
                                        "id": contact_id,
                                        "source_id": contact.get("source_id") or contact.get("identifier") or identifier
                                    }
                    except Exception:
                        pass
                
                # Method 2: List contacts and find by identifier
                try:
                    list_url = f"{CHATWOOT_API_URL}/accounts/{account_id}/contacts"
                    # Try multiple pages if needed
                    for page in range(1, 4):  # Check first 3 pages
                        list_params = {"page": page}
                        list_response = requests.get(list_url, headers=headers, params=list_params, timeout=10)
                        if list_response.status_code == 200:
                            list_data = list_response.json()
                            contacts = list_data.get("payload", [])
                            if not contacts:
                                break
                            # Find contact by identifier or phone
                            for contact in contacts:
                                contact_identifier = contact.get("identifier", "")
                                contact_phone = contact.get("phone_number", "")
                                if (contact_identifier == identifier or 
                                    (normalized_phone and contact_phone == normalized_phone) or
                                    (phone and contact_phone == phone)):
                                    contact_id = contact.get("id")
                                    if contact_id:
                                        print(f"   Found existing contact in list")
                                        return {
                                            "id": contact_id,
                                            "source_id": contact.get("source_id") or contact.get("identifier") or identifier
                                        }
                except Exception as list_err:
                    print(f"   Warning: Could not list contacts: {list_err}")
            
            # If we couldn't recover, print error
            print(f"   Error creating contact: {e}")
            if error_text:
                print(f"   Response: {error_text[:200]}")  # Limit error message length
        return None
    except requests.exceptions.RequestException as e:
        print(f"   Error creating contact: {e}")
        return None


def create_conversation(account_id: str, inbox_id: str, api_token: str, contact_id: int, source_id: str) -> Optional[Dict]:
    """
    Create a conversation in Chatwoot.
    Returns conversation data if successful.
    
    According to Chatwoot API docs, requires:
    - source_id (required): Conversation source id
    - inbox_id (required): Id of inbox
    - contact_id (optional but recommended): Contact Id for which conversation is created
    """
    headers = {
        "api_access_token": api_token,
        "Content-Type": "application/json"
    }
    
    # Build conversation data with required fields
    conversation_data = {
        "source_id": source_id,
        "inbox_id": int(inbox_id)
    }
    
    # Add contact_id if available (recommended by API docs)
    if contact_id:
        conversation_data["contact_id"] = int(contact_id)
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{account_id}/conversations",
            json=conversation_data,
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        conversation_response = response.json()
        conversation_id = conversation_response.get("id")
        if not conversation_id:
            print(f"   Error: Conversation creation response missing 'id' field")
            print(f"   Response: {conversation_response}")
            return None
        return conversation_response
    except requests.exceptions.HTTPError as e:
        # Provide more detailed error information
        error_msg = f"   Error creating conversation: {e}"
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_data = e.response.json()
                error_msg += f"\n   Status: {e.response.status_code}"
                error_msg += f"\n   Response: {error_data}"
            except:
                error_msg += f"\n   Response: {e.response.text}"
        print(error_msg)
        return None
    except requests.exceptions.RequestException as e:
        print(f"   Error creating conversation: {e}")
        return None


def set_conversation_priority(account_id: str, conversation_id: int, api_token: str, priority: str) -> bool:
    """
    Set priority on a conversation.
    Priority values: 'low', 'medium', 'high', 'urgent', or None/null to clear.
    """
    headers = {
        "api_access_token": api_token,
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{account_id}/conversations/{conversation_id}/toggle_priority",
            json={"priority": priority},
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        return True
    except requests.exceptions.HTTPError as e:
        error_msg = f"   Error setting priority: {e}"
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_data = e.response.json()
                error_msg += f"\n   Status: {e.response.status_code}"
                error_msg += f"\n   Response: {error_data}"
            except:
                error_msg += f"\n   Response: {e.response.text}"
        print(error_msg)
        return False
    except requests.exceptions.RequestException as e:
        print(f"   Error setting priority: {e}")
        return False
    except requests.exceptions.RequestException as e:
        print(f"   Error setting priority: {e}")
        return False


def add_message(account_id: str, conversation_id: int, api_token: str, content: str) -> bool:
    """Add a message to a conversation."""
    headers = {
        "api_access_token": api_token,
        "Content-Type": "application/json"
    }
    
    message_data = {
        "content": content,
        "message_type": "incoming"
    }
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{account_id}/conversations/{conversation_id}/messages",
            json=message_data,
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        print(f"   Error adding message: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   Response: {e.response.text}")
        return False


def add_labels(account_id: str, conversation_id: int, api_token: str, labels: List[str]) -> bool:
    """Add labels to a conversation."""
    if not labels:
        return True
    
    headers = {
        "api_access_token": api_token,
        "Content-Type": "application/json"
    }
    
    label_data = {
        "labels": labels
    }
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{account_id}/conversations/{conversation_id}/labels",
            json=label_data,
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        print(f"   Warning: Could not add labels: {e}")
        return False


def add_custom_attributes(account_id: str, conversation_id: int, api_token: str, attributes: Dict) -> bool:
    """Add custom attributes to a conversation."""
    if not attributes:
        return True
    
    headers = {
        "api_access_token": api_token,
        "Content-Type": "application/json"
    }
    
    attr_data = {
        "custom_attributes": attributes
    }
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{account_id}/conversations/{conversation_id}/custom_attributes",
            json=attr_data,
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        print(f"   Warning: Could not add custom attributes: {e}")
        return False


def add_private_note(account_id: str, conversation_id: int, api_token: str, content: str) -> bool:
    """Add a private note to a conversation."""
    headers = {
        "api_access_token": api_token,
        "Content-Type": "application/json"
    }
    
    # Private notes use message_type "activity" and private flag
    note_data = {
        "content": content,
        "message_type": "activity",
        "private": True
    }
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{account_id}/conversations/{conversation_id}/messages",
            json=note_data,
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        print(f"   Warning: Could not add private note: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   Response: {e.response.text}")
        return False


def normalize_label(label: Optional[str]) -> Optional[str]:
    """
    Normalize labels to consistent, lowercase, snake_case format.
    
    Examples:
    - "Appointment Issue" -> "appointment_issue"
    - "General OPD" -> "dept_general_opd"
    - "Medium" -> "priority_medium"
    """
    if not label:
        return None
    
    # Convert to lowercase
    normalized = str(label).lower().strip()
    
    # Replace spaces and special chars with underscores
    normalized = normalized.replace(" ", "_").replace("-", "_").replace("/", "_")
    
    # Remove multiple underscores
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    
    # Remove leading/trailing underscores
    normalized = normalized.strip("_")
    
    return normalized if normalized else None


def generate_tldr(ticket_data: Dict) -> str:
    """
    Generate a one-line TL;DR summary for call-center agents.
    
    Rules:
    - Max 1 sentence
    - Start with the outcome
    - Plain English, no jargon
    - Factual and concise
    - Example: "Appointment was already booked with Dr. Shashank Shetty at the Hanoor branch."
    """
    outcome = ticket_data.get("outcome", "")
    call_classification = ticket_data.get("call_classification", "")
    ticket_notes = ticket_data.get("ticket_notes", "")
    call_solution = ticket_data.get("call_solution", "")
    customer_name = ticket_data.get("customer_name", "")
    action_description = ticket_data.get("action_description", "")
    doctor_name = ticket_data.get("doctor_name", "")
    hospital_name = ticket_data.get("hospital_name", "")
    location = ticket_data.get("location", "")
    
    # Build TL;DR starting with outcome/action
    tldr_parts = []
    
    # Determine primary action/outcome
    classification_lower = call_classification.lower() if call_classification else ""
    notes_lower = ticket_notes.lower() if ticket_notes else ""
    
    # Appointment-related TL;DR
    if "appointment" in classification_lower:
        if "booked" in notes_lower or outcome == "BOOKED":
            tldr_parts.append("Appointment was booked")
        elif "reschedule" in notes_lower or "change" in notes_lower or outcome == "RESCHEDULED":
            if outcome == "CALLBACK":
                tldr_parts.append("Callback scheduled to reschedule appointment")
            else:
                tldr_parts.append("Appointment rescheduling requested")
        elif "cancel" in notes_lower or outcome == "CANCELLED":
            tldr_parts.append("Appointment cancellation requested")
        else:
            tldr_parts.append("Appointment issue")
        
        # Add doctor name
        if doctor_name:
            tldr_parts.append(f"with Dr. {doctor_name}")
        
        # Add location/branch if available
        if location:
            tldr_parts.append(f"at the {location} branch")
        elif hospital_name:
            tldr_parts.append(f"at {hospital_name}")
    
    # Follow-up TL;DR
    elif "follow-up" in classification_lower or "followup" in classification_lower:
        if outcome == "RESOLVED":
            tldr_parts.append("Follow-up issue resolved")
        elif outcome == "CALLBACK":
            tldr_parts.append("Follow-up callback scheduled")
        else:
            tldr_parts.append("Follow-up required")
        
        if customer_name and customer_name != "Call Customer":
            tldr_parts.append(f"for {customer_name}")
    
    # Enquiry TL;DR
    elif "enquiry" in classification_lower:
        if outcome == "RESOLVED":
            tldr_parts.append("Enquiry resolved")
        elif outcome == "BOOKED":
            tldr_parts.append("Enquiry converted to appointment")
        else:
            tldr_parts.append("Enquiry received")
    
    # Complaint TL;DR
    elif "complaint" in classification_lower:
        if outcome == "RESOLVED":
            tldr_parts.append("Complaint resolved")
        elif outcome == "ESCALATED":
            tldr_parts.append("Complaint escalated")
        else:
            tldr_parts.append("Complaint received")
    
    # Default based on outcome
    else:
        outcome_map = {
            "CALLBACK": "Callback scheduled",
            "RESOLVED": "Issue resolved",
            "FOLLOWUP": "Follow-up arranged",
            "ESCALATED": "Issue escalated",
            "BOOKED": "Appointment booked",
            "RESCHEDULED": "Appointment rescheduled",
            "CANCELLED": "Appointment cancelled",
            "INFORMATION CALL": "Information provided",
        }
        tldr_parts.append(outcome_map.get(outcome, "Call completed"))
    
    # Add action requirement if needed (but keep it concise and natural)
    if action_description and "callback" not in " ".join(tldr_parts).lower():
        action_lower = action_description.lower()
        if "callback" in action_lower:
            # Only add if callback not already mentioned
            if "Callback" not in tldr_parts[0] and "callback" not in tldr_parts[0].lower():
                tldr_parts.append("callback required")
    
    # Combine into one sentence
    tldr = " ".join(tldr_parts) + "."
    
    # Ensure it's concise (max 150 chars for TL;DR)
    if len(tldr) > 150:
        # Keep first part only
        tldr = tldr_parts[0] + "."
    
    # Capitalize first letter
    tldr = tldr[0].upper() + tldr[1:] if tldr else tldr
    
    return tldr


def generate_conversation_message(ticket_data: Dict) -> str:
    """
    Generate a concise, scannable conversation message with bullet points.
    Clearly states: Issue, Doctor (if available), Scheduled time, Patient request.
    """
    call_classification = ticket_data.get("call_classification", "")
    ticket_notes = ticket_data.get("ticket_notes", "")
    doctor_name = ticket_data.get("doctor_name")
    customer_name = ticket_data.get("customer_name")
    department = ticket_data.get("department_to_handle")
    
    # Build scannable message
    message_parts = []
    
    # TL;DR at the top (one-line summary for agents)
    tldr = generate_tldr(ticket_data)
    if tldr:
        message_parts.append(f"**TL;DR:** {tldr}")
    
    # Header
    if call_classification:
        message_parts.append(f"\n**{call_classification}**")
    
    # Issue summary
    if ticket_notes:
        message_parts.append(f"\n**Issue:** {ticket_notes}")
    elif call_classification:
        message_parts.append(f"\n**Issue:** {call_classification}")
    
    # Key details in bullet format
    details = []
    
    if customer_name:
        details.append(f"• Patient: {customer_name}")
    
    if doctor_name:
        details.append(f"• Doctor: {doctor_name}")
    
    if department:
        details.append(f"• Department: {department}")
    
    # Extract time/appointment info from notes if available
    ticket_notes_lower = ticket_notes.lower() if ticket_notes else ""
    if "appointment" in ticket_notes_lower or "schedule" in ticket_notes_lower:
        # Try to extract time-related info
        if "next week" in ticket_notes_lower:
            details.append("• Scheduled: Next week")
        elif "next month" in ticket_notes_lower:
            details.append("• Scheduled: Next month")
        elif "today" in ticket_notes_lower:
            details.append("• Scheduled: Today")
    
    if details:
        message_parts.append("\n" + "\n".join(details))
    
    # Patient request (from ticket_notes or action_description)
    action_description = ticket_data.get("action_description")
    if action_description:
        message_parts.append(f"\n**Request:** {action_description}")
    elif ticket_notes:
        # Extract request from notes
        message_parts.append(f"\n**Request:** {ticket_notes}")
    
    return "\n".join(message_parts) if message_parts else "Call ticket created from call intelligence system."


def generate_internal_notes(ticket_data: Dict) -> str:
    """
    Generate decision-focused internal notes.
    Includes: Action required, Next step, Suggested owner/team, Current status.
    """
    action_required = ticket_data.get("action_required", "No")
    action_description = ticket_data.get("action_description", "")
    call_solution = ticket_data.get("call_solution", "")
    ticket_notes = ticket_data.get("ticket_notes", "")
    department = ticket_data.get("department_to_handle", "")
    priority = ticket_data.get("priority", "")
    outcome = ticket_data.get("outcome", "")
    
    note_sections = []
    
    # Action Required
    action_status = "YES" if str(action_required).upper() == "YES" else "NO"
    note_sections.append(f"**Action Required:** {action_status}")
    
    if action_description:
        note_sections.append(f"**Action:** {action_description}")
    
    # Next Step
    next_steps = []
    if call_solution:
        next_steps.append(call_solution)
    elif action_description:
        next_steps.append(action_description)
    elif outcome:
        outcome_map = {
            "CALLBACK": "Schedule callback with patient",
            "FOLLOWUP": "Follow up required",
            "RESOLVED": "Ticket resolved during call",
            "ESCALATED": "Escalate to appropriate team"
        }
        next_steps.append(outcome_map.get(outcome, f"Process {outcome.lower()}"))
    else:
        next_steps.append("Review ticket and take appropriate action")
    
    if next_steps:
        note_sections.append(f"**Next Step:** {next_steps[0]}")
    
    # Suggested Owner/Team
    if department:
        note_sections.append(f"**Suggested Team:** {department}")
    
    # Current Status
    status_parts = []
    if priority:
        status_parts.append(f"Priority: {priority}")
    if outcome:
        status_parts.append(f"Outcome: {outcome}")
    if ticket_notes:
        status_parts.append(f"Summary: {ticket_notes[:100]}...")
    
    if status_parts:
        note_sections.append(f"**Status:** {' | '.join(status_parts)}")
    
    # Additional context
    if call_solution and call_solution != next_steps[0]:
        note_sections.append(f"\n**Call Resolution:** {call_solution}")
    
    return "\n\n".join(note_sections)


def generate_resolution_summary(ticket_data: Dict) -> str:
    """
    Generate a resolution-ready summary in past tense.
    One short paragraph suitable for closing the ticket later.
    """
    call_classification = ticket_data.get("call_classification", "issue")
    call_solution = ticket_data.get("call_solution", "")
    ticket_notes = ticket_data.get("ticket_notes", "")
    outcome = ticket_data.get("outcome", "")
    customer_name = ticket_data.get("customer_name", "patient")
    
    # Build resolution summary in past tense
    summary_parts = []
    
    # Start with what happened
    if ticket_notes:
        summary_parts.append(f"Patient {customer_name} contacted regarding {call_classification.lower()}: {ticket_notes.lower()}")
    else:
        summary_parts.append(f"Patient {customer_name} contacted regarding {call_classification.lower()}")
    
    # Add resolution
    if call_solution:
        summary_parts.append(f"Resolution: {call_solution.lower()}")
    elif outcome:
        outcome_text = {
            "CALLBACK": "callback was scheduled",
            "RESOLVED": "issue was resolved",
            "FOLLOWUP": "follow-up was arranged",
            "ESCALATED": "ticket was escalated"
        }
        summary_parts.append(f"{outcome_text.get(outcome, 'appropriate action was taken')}")
    else:
        summary_parts.append("appropriate action was taken")
    
    # Combine into one paragraph
    summary = ". ".join(summary_parts) + "."
    
    # Ensure it's a reasonable length (max 300 chars for summary)
    if len(summary) > 300:
        summary = summary[:297] + "..."
    
    return summary


def transform_ticket_to_chatwoot(ticket_data: Dict, filename: str) -> Dict:
    """
    Transform ticket JSON to Chatwoot conversation structure with improved quality.
    
    Improvements:
    - Scannable conversation message with bullet points
    - Decision-focused internal notes
    - Normalized snake_case labels
    - Resolution-ready summary
    
    Mapping:
    - call_classification -> Normalized label
    - department_to_handle -> Normalized label
    - priority -> Normalized label
    - ticket_notes + call_solution -> Enhanced private note
    - transcript -> Initial message (or generated scannable message)
    - action_required -> Custom attribute + internal note
    - action_description -> Custom attribute + internal note
    - customer_sentiment_label -> Custom attribute
    - customer_sentiment_summary -> Custom attribute
    - agent_sentiment_label -> Custom attribute
    - agent_sentiment_summary -> Custom attribute
    - timestamp -> Custom attribute
    """
    
    # Extract fields
    call_classification = ticket_data.get("call_classification")
    department = ticket_data.get("department_to_handle")
    priority = ticket_data.get("priority")
    ticket_notes = ticket_data.get("ticket_notes")
    call_solution = ticket_data.get("call_solution")
    transcript = ticket_data.get("transcript", "")
    action_required = ticket_data.get("action_required")
    action_description = ticket_data.get("action_description")
    customer_sentiment_label = ticket_data.get("customer_sentiment_label")
    customer_sentiment_summary = ticket_data.get("customer_sentiment_summary")
    agent_sentiment_label = ticket_data.get("agent_sentiment_label")
    agent_sentiment_summary = ticket_data.get("agent_sentiment_summary")
    # Backward compatibility: if old sentiment_label exists, use it as customer_sentiment_label
    if not customer_sentiment_label:
        sentiment_label = ticket_data.get("sentiment_label")
        if sentiment_label:
            customer_sentiment_label = sentiment_label
    if not customer_sentiment_summary:
        sentiment_summary = ticket_data.get("sentiment_summary")
        if sentiment_summary:
            customer_sentiment_summary = sentiment_summary
    timestamp = ticket_data.get("timestamp")
    customer_name = ticket_data.get("customer_name")
    phone_number = ticket_data.get("phone_number")
    
    # Build normalized labels (snake_case, lowercase)
    labels = []
    if call_classification:
        normalized_class = normalize_label(call_classification)
        if normalized_class:
            labels.append(normalized_class)
    
    if department:
        normalized_dept = normalize_label(department)
        if normalized_dept:
            # Add dept_ prefix for departments
            if not normalized_dept.startswith("dept_"):
                labels.append(f"dept_{normalized_dept}")
            else:
                labels.append(normalized_dept)
    
    if priority:
        normalized_priority = normalize_label(priority)
        if normalized_priority:
            # Add priority_ prefix
            if not normalized_priority.startswith("priority_"):
                labels.append(f"priority_{normalized_priority}")
            else:
                labels.append(normalized_priority)
    
    # Build custom attributes
    custom_attrs = {}
    if action_required:
        custom_attrs["action_required"] = str(action_required)
    if action_description:
        custom_attrs["action_description"] = str(action_description)
    if customer_sentiment_label:
        custom_attrs["customer_sentiment_label"] = str(customer_sentiment_label)
    if customer_sentiment_summary:
        custom_attrs["customer_sentiment_summary"] = str(customer_sentiment_summary)
    if agent_sentiment_label:
        custom_attrs["agent_sentiment_label"] = str(agent_sentiment_label)
    if agent_sentiment_summary:
        custom_attrs["agent_sentiment_summary"] = str(agent_sentiment_summary)
    if timestamp:
        custom_attrs["call_timestamp"] = str(timestamp)
    
    # Generate improved conversation message (scannable, bullet points)
    # Use generated message if transcript is too long or not available
    if transcript and len(transcript) < 500:
        conversation_message = transcript
    else:
        conversation_message = generate_conversation_message(ticket_data)
    
    # Generate decision-focused internal notes
    internal_note = generate_internal_notes(ticket_data)
    
    # Generate TL;DR (one-line agent summary)
    tldr = generate_tldr(ticket_data)
    
    # Generate resolution-ready summary
    resolution_summary = generate_resolution_summary(ticket_data)
    
    # Add TL;DR and resolution summary to custom attributes for easy access
    custom_attrs["tldr"] = tldr
    custom_attrs["resolution_summary"] = resolution_summary
    
    return {
        "labels": labels,
        "custom_attributes": custom_attrs,
        "conversation_message": conversation_message,
        "internal_note": internal_note,
        "tldr": tldr,
        "resolution_summary": resolution_summary,
        "customer_name": customer_name,
        "phone_number": phone_number,
        "priority": normalize_priority(priority)
    }


def ingest_ticket_to_chatwoot(ticket_data: Dict, filename: str) -> bool:
    """
    Ingest a single ticket JSON into Chatwoot.
    Returns True if successful, False otherwise.
    """
    print(f"\nProcessing ticket: {filename}")
    
    # Check recordType
    record_type = ticket_data.get("recordType", "").lower()
    if record_type != "ticket":
        print(f"   SKIPPED: recordType is '{record_type}', not 'ticket'")
        return False
    
    # Transform data
    chatwoot_data = transform_ticket_to_chatwoot(ticket_data, filename)
    
    # Create or find contact
    contact_info = create_contact(
        CHATWOOT_ACCOUNT_ID,
        CHATWOOT_API_TOKEN,
        chatwoot_data["customer_name"],
        chatwoot_data["phone_number"]
    )
    
    if not contact_info:
        print("   ERROR: Could not create/find contact")
        return False
    
    contact_id = contact_info.get("id")
    source_id = contact_info.get("source_id")
    
    if not contact_id:
        print("   ERROR: Contact info missing 'id' field")
        print(f"   Contact info: {contact_info}")
        return False
    
    if not source_id:
        print("   ERROR: Contact info missing 'source_id' field")
        print(f"   Contact info: {contact_info}")
        return False
    
    print(f"   Contact ID: {contact_id}")
    print(f"   Source ID: {source_id}")
    
    # Create conversation using contact's source_id
    conversation = create_conversation(
        CHATWOOT_ACCOUNT_ID,
        CHATWOOT_INBOX_ID,
        CHATWOOT_API_TOKEN,
        contact_id,
        source_id
    )
    
    if not conversation:
        print("   ERROR: Could not create conversation")
        return False
    
    conversation_id = conversation.get("id")
    if not conversation_id:
        print("   ERROR: Conversation response missing 'id' field")
        print(f"   Conversation response: {conversation}")
        return False
    print(f"   Conversation ID: {conversation_id}")
    
    # Add initial message (improved scannable format)
    if chatwoot_data.get("conversation_message"):
        if add_message(
            CHATWOOT_ACCOUNT_ID,
            conversation_id,
            CHATWOOT_API_TOKEN,
            chatwoot_data["conversation_message"]
        ):
            print("   Added conversation message")
    
    # Set priority
    if chatwoot_data.get("priority"):
        priority_value = chatwoot_data["priority"]
        if set_conversation_priority(
            CHATWOOT_ACCOUNT_ID,
            conversation_id,
            CHATWOOT_API_TOKEN,
            priority_value
        ):
            print(f"   Set priority: {priority_value}")
    
    # Add labels
    if chatwoot_data["labels"]:
        if add_labels(
            CHATWOOT_ACCOUNT_ID,
            conversation_id,
            CHATWOOT_API_TOKEN,
            chatwoot_data["labels"]
        ):
            print(f"   Added labels: {', '.join(chatwoot_data['labels'])}")
    
    # Add custom attributes
    if chatwoot_data["custom_attributes"]:
        if add_custom_attributes(
            CHATWOOT_ACCOUNT_ID,
            conversation_id,
            CHATWOOT_API_TOKEN,
            chatwoot_data["custom_attributes"]
        ):
            print("   Added custom attributes")
    
    # Add internal note (decision-focused)
    if chatwoot_data.get("internal_note"):
        if add_private_note(
            CHATWOOT_ACCOUNT_ID,
            conversation_id,
            CHATWOOT_API_TOKEN,
            chatwoot_data["internal_note"]
        ):
            print("   Added internal notes")
    
    print(f"   Successfully created ticket in Chatwoot")
    # Generate view URL (works for both hosted and localhost)
    base_url = CHATWOOT_API_URL.replace("/api/v1", "")
    view_url = f"{base_url}/app/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/{conversation_id}"
    print(f"   View at: {view_url}")
    
    return True


def main():
    """Main processing loop."""
    print("Chatwoot Ticket Ingestion Script")
    print("=" * 60)
    print("This script reads TICKET JSON files from the output folder")
    print("and creates conversations (tickets) in Chatwoot.")
    print("=" * 60)
    print(f"Chatwoot API URL: {CHATWOOT_API_URL}")
    print(f"Account ID: {CHATWOOT_ACCOUNT_ID}")
    print(f"Inbox ID: {CHATWOOT_INBOX_ID}")
    print(f"API Token configured: {'Yes' if CHATWOOT_API_TOKEN else 'No'}")
    if CHATWOOT_ACCOUNT_ID:
        base_url = CHATWOOT_API_URL.replace("/api/v1", "")
        print(f"View dashboard: {base_url}/app/accounts/{CHATWOOT_ACCOUNT_ID}/conversations")
    print()
    
    # Verify account and inbox exist before processing
    print("Verifying account and inbox access...")
    if not verify_account_and_inbox(CHATWOOT_ACCOUNT_ID, CHATWOOT_INBOX_ID, CHATWOOT_API_TOKEN):
        print("\nERROR: Account or inbox verification failed. Please check your configuration.")
        print("   Fix the issues above and try again.")
        exit(1)
    print()
    
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
    skipped_count = 0
    failed_count = 0
    
    for json_file in json_files:
        filename = json_file.name
        try:
            with open(json_file, "r") as f:
                ticket_data = json.load(f)
            
            result = ingest_ticket_to_chatwoot(ticket_data, filename)
            
            if result:
                success_count += 1
            else:
                # Check if it was skipped (not a ticket)
                record_type = ticket_data.get("recordType", "").lower()
                if record_type != "ticket":
                    skipped_count += 1
                else:
                    failed_count += 1
                    
        except KeyError as e:
            print(f"Error processing {filename}: Missing key '{e}' in API response")
            print(f"   This usually means the API response structure is different than expected")
            print(f"   Check the API response format or contact support")
            failed_count += 1
            continue
        except Exception as e:
            import traceback
            print(f"Error processing {filename}: {e}")
            print(f"   Error type: {type(e).__name__}")
            # Only show traceback for unexpected errors
            if "KeyError" not in str(type(e)):
                traceback.print_exc()
            failed_count += 1
            continue
    
    print("\n" + "=" * 60)
    print("Processing complete!")
    print(f"   Successfully created: {success_count}")
    print(f"   Skipped (not tickets): {skipped_count}")
    print(f"   Failed: {failed_count}")
    print("=" * 60)


if __name__ == "__main__":
    main()

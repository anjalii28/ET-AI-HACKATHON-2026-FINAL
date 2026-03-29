#!/usr/bin/env python3
"""
Update existing Chatwoot conversations with improved format.

This script:
1. Fetches existing conversations from Chatwoot
2. Extracts ticket data from conversation messages/attributes
3. Regenerates improved format (TL;DR, normalized labels, etc.)
4. Updates conversations with new format
"""

import os
import json
import requests
from dotenv import load_dotenv
from typing import Dict, Optional, List
import re
from pathlib import Path

# Import functions from send_to_chatwoot
from send_to_chatwoot import (
    generate_tldr,
    generate_conversation_message,
    generate_internal_notes,
    generate_resolution_summary,
    normalize_label,
    normalize_priority
)

OUTPUT_DIR = "output"

load_dotenv()

CHATWOOT_API_URL = os.environ.get("CHATWOOT_API_URL", "http://localhost:3001/api/v1")
CHATWOOT_API_TOKEN = os.environ.get("CHATWOOT_API_TOKEN")
CHATWOOT_ACCOUNT_ID = os.environ.get("CHATWOOT_ACCOUNT_ID", "3")

if not CHATWOOT_API_TOKEN:
    print("ERROR: CHATWOOT_API_TOKEN not found in .env file")
    exit(1)

def get_headers() -> Dict:
    """Get API headers."""
    return {
        "api_access_token": CHATWOOT_API_TOKEN,
        "Content-Type": "application/json"
    }

def get_all_conversations() -> List[Dict]:
    """Get all conversations from Chatwoot."""
    print("Fetching existing conversations...")
    headers = get_headers()
    conversations = []
    page = 1
    
    while True:
        try:
            response = requests.get(
                f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations",
                headers=headers,
                params={"page": page},
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            # Handle different response formats
            if isinstance(data, dict):
                if "data" in data and isinstance(data["data"], dict) and "payload" in data["data"]:
                    page_conversations = data["data"]["payload"]
                elif "payload" in data:
                    page_conversations = data["payload"]
                else:
                    break
            elif isinstance(data, list):
                page_conversations = data
            else:
                break
            
            if not page_conversations:
                break
            
            conversations.extend(page_conversations)
            print(f"  Fetched {len(page_conversations)} conversations (page {page}, total: {len(conversations)})")
            page += 1
            
            if page > 50:  # Safety limit
                break
                
        except Exception as e:
            print(f"  Error fetching page {page}: {e}")
            break
    
    print(f"Total conversations found: {len(conversations)}")
    return conversations

def get_conversation_messages(conversation_id: int) -> List[Dict]:
    """Get all messages for a conversation."""
    headers = get_headers()
    try:
        response = requests.get(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/{conversation_id}/messages",
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        if isinstance(data, dict) and "payload" in data:
            return data["payload"]
        elif isinstance(data, list):
            return data
        return []
    except Exception as e:
        print(f"    Warning: Could not fetch messages: {e}")
        return []

def find_matching_json_file(conversation: Dict) -> Optional[Dict]:
    """Try to find matching JSON file from output directory."""
    # Try to match by contact name or phone number
    contact_name = conversation.get("meta", {}).get("sender", {}).get("name")
    phone_number = conversation.get("meta", {}).get("sender", {}).get("phone_number")
    
    if not os.path.exists(OUTPUT_DIR):
        return None
    
    json_files = list(Path(OUTPUT_DIR).glob("*.json"))
    
    for json_file in json_files:
        try:
            with open(json_file, "r") as f:
                ticket_data = json.load(f)
            
            # Match by customer name
            if contact_name and ticket_data.get("customer_name") == contact_name:
                return ticket_data
            
            # Match by phone number
            if phone_number and ticket_data.get("phone_number") == phone_number:
                return ticket_data
            
            # Match by filename pattern (if conversation has source_id)
            source_id = conversation.get("source_id", "")
            if source_id and source_id.replace("call-", "") in json_file.name:
                return ticket_data
                
        except:
            continue
    
    return None

def extract_ticket_data_from_conversation(conversation: Dict, messages: List[Dict]) -> Optional[Dict]:
    """
    Extract ticket data from existing conversation.
    Tries to reconstruct JSON structure from conversation messages and attributes.
    """
    # Get custom attributes
    custom_attrs = conversation.get("custom_attributes", {})
    
    # Get first message (usually contains transcript or summary)
    first_message = None
    if messages:
        # Find first incoming message
        for msg in messages:
            if msg.get("message_type") == "incoming" and msg.get("content"):
                first_message = msg.get("content", "")
                break
    
    # Try to extract data from custom attributes
    ticket_data = {
        "call_classification": custom_attrs.get("call_classification") or conversation.get("meta", {}).get("channel", ""),
        "action_required": custom_attrs.get("action_required", "No"),
        "action_description": custom_attrs.get("action_description"),
        "department_to_handle": custom_attrs.get("department") or custom_attrs.get("department_to_handle"),
        "priority": custom_attrs.get("priority"),
        "ticket_notes": custom_attrs.get("ticket_notes"),
        "call_solution": custom_attrs.get("call_solution"),
        "transcript": first_message or "",
        "customer_name": conversation.get("meta", {}).get("sender", {}).get("name"),
        "phone_number": conversation.get("meta", {}).get("sender", {}).get("phone_number"),
        "customer_sentiment_label": custom_attrs.get("customer_sentiment_label") or custom_attrs.get("sentiment_label"),  # Backward compatibility
        "customer_sentiment_summary": custom_attrs.get("customer_sentiment_summary") or custom_attrs.get("sentiment_summary"),  # Backward compatibility
        "agent_sentiment_label": custom_attrs.get("agent_sentiment_label"),
        "agent_sentiment_summary": custom_attrs.get("agent_sentiment_summary"),
        "sentiment_label": custom_attrs.get("sentiment_label"),  # Keep for backward compatibility
        "sentiment_summary": custom_attrs.get("sentiment_summary"),  # Keep for backward compatibility
        "timestamp": custom_attrs.get("call_timestamp"),
        "outcome": custom_attrs.get("outcome"),
        "doctor_name": custom_attrs.get("doctor_name"),
        "hospital_name": custom_attrs.get("hospital_name"),
        "location": custom_attrs.get("location"),
    }
    
    # Try to extract from first message if it looks like structured data
    if first_message:
        # Check if message contains structured info
        if "**Issue:**" in first_message:
            # Extract issue
            issue_match = re.search(r"\*\*Issue:\*\*\s*(.+?)(?:\n|$)", first_message)
            if issue_match:
                ticket_data["ticket_notes"] = issue_match.group(1).strip()
        
        if "**Request:**" in first_message:
            request_match = re.search(r"\*\*Request:\*\*\s*(.+?)(?:\n|$)", first_message)
            if request_match:
                ticket_data["action_description"] = request_match.group(1).strip()
    
    return ticket_data

def conversation_has_tldr(conversation: Dict, messages: List[Dict]) -> bool:
    """Check if conversation already has TL;DR format."""
    # Check custom attributes
    custom_attrs = conversation.get("custom_attributes", {})
    if custom_attrs.get("tldr"):
        return True
    
    # Check first message for TL;DR
    if messages:
        for msg in messages:
            content = msg.get("content", "")
            if "**TL;DR:**" in content or "TL;DR:" in content:
                return True
    
    return False

def add_improved_message(conversation_id: int, new_message: str) -> bool:
    """Add improved message to conversation (Chatwoot doesn't support editing messages)."""
    headers = get_headers()
    try:
        # Add as a new message at the top
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/{conversation_id}/messages",
            json={"content": new_message, "message_type": "incoming"},
            headers=headers,
            timeout=30
        )
        return response.status_code == 200
    except Exception as e:
        print(f"    Error adding message: {e}")
        return False

def update_conversation_labels(conversation_id: int, new_labels: List[str]) -> bool:
    """Update conversation labels."""
    headers = get_headers()
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/{conversation_id}/labels",
            json={"labels": new_labels},
            headers=headers,
            timeout=30
        )
        return response.status_code == 200
    except:
        return False

def update_conversation_custom_attributes(conversation_id: int, new_attrs: Dict) -> bool:
    """Update conversation custom attributes."""
    headers = get_headers()
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/{conversation_id}/custom_attributes",
            json={"custom_attributes": new_attrs},
            headers=headers,
            timeout=30
        )
        return response.status_code == 200
    except:
        return False

def add_private_note(conversation_id: int, note_content: str) -> bool:
    """Add a private note to conversation."""
    headers = get_headers()
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/{conversation_id}/messages",
            json={
                "content": note_content,
                "message_type": "activity",
                "private": True
            },
            headers=headers,
            timeout=30
        )
        return response.status_code == 200
    except:
        return False

def update_conversation(conversation: Dict) -> bool:
    """Update a single conversation with improved format."""
    conversation_id = conversation.get("id")
    if not conversation_id:
        return False
    
    print(f"\nUpdating conversation {conversation_id}...")
    
    # Get messages
    messages = get_conversation_messages(conversation_id)
    
    # Check if already updated
    if conversation_has_tldr(conversation, messages):
        print(f"  Skipped: Already has TL;DR format")
        return False
    
    # Try to find matching JSON file first (most accurate)
    ticket_data = find_matching_json_file(conversation)
    
    # If no JSON file found, extract from conversation
    if not ticket_data:
        ticket_data = extract_ticket_data_from_conversation(conversation, messages)
        if not ticket_data:
            print(f"  Skipped: Could not extract ticket data")
            return False
        print(f"  Using data extracted from conversation")
    else:
        print(f"  Found matching JSON file, using original data")
    
    # Generate improved format
    tldr = generate_tldr(ticket_data)
    new_message = generate_conversation_message(ticket_data)
    internal_note = generate_internal_notes(ticket_data)
    resolution_summary = generate_resolution_summary(ticket_data)
    
    # Generate normalized labels
    labels = []
    call_classification = ticket_data.get("call_classification")
    department = ticket_data.get("department_to_handle")
    priority = ticket_data.get("priority")
    
    if call_classification:
        normalized_class = normalize_label(call_classification)
        if normalized_class:
            labels.append(normalized_class)
    
    if department:
        normalized_dept = normalize_label(department)
        if normalized_dept and not normalized_dept.startswith("dept_"):
            labels.append(f"dept_{normalized_dept}")
    
    if priority:
        normalized_priority = normalize_label(priority)
        if normalized_priority and not normalized_priority.startswith("priority_"):
            labels.append(f"priority_{normalized_priority}")
    
    # Build custom attributes
    custom_attrs = {
        "tldr": tldr,
        "resolution_summary": resolution_summary,
        "action_required": str(ticket_data.get("action_required", "No")),
    }
    
    if ticket_data.get("action_description"):
        custom_attrs["action_description"] = ticket_data["action_description"]
    # Handle both customer and agent sentiments (with backward compatibility)
    if ticket_data.get("customer_sentiment_label"):
        custom_attrs["customer_sentiment_label"] = ticket_data["customer_sentiment_label"]
    if ticket_data.get("customer_sentiment_summary"):
        custom_attrs["customer_sentiment_summary"] = ticket_data["customer_sentiment_summary"]
    if ticket_data.get("agent_sentiment_label"):
        custom_attrs["agent_sentiment_label"] = ticket_data["agent_sentiment_label"]
    if ticket_data.get("agent_sentiment_summary"):
        custom_attrs["agent_sentiment_summary"] = ticket_data["agent_sentiment_summary"]
    # Backward compatibility: if old sentiment_label exists, use it as customer_sentiment_label
    if ticket_data.get("sentiment_label") and not ticket_data.get("customer_sentiment_label"):
        custom_attrs["customer_sentiment_label"] = ticket_data["sentiment_label"]
    if ticket_data.get("sentiment_summary") and not ticket_data.get("customer_sentiment_summary"):
        custom_attrs["customer_sentiment_summary"] = ticket_data["sentiment_summary"]
    if ticket_data.get("timestamp"):
        custom_attrs["call_timestamp"] = ticket_data["timestamp"]
    
    # Update conversation
    success_count = 0
    
    # Add improved message (Chatwoot doesn't support editing, so we add a new one)
    if add_improved_message(conversation_id, new_message):
        print(f"  Added improved conversation message with TL;DR")
        success_count += 1
    
    # Update labels
    if labels and update_conversation_labels(conversation_id, labels):
        print(f"  Updated labels: {', '.join(labels)}")
        success_count += 1
    
    # Update custom attributes
    if update_conversation_custom_attributes(conversation_id, custom_attrs):
        print(f"  Updated custom attributes (TL;DR, resolution summary)")
        success_count += 1
    
    # Add internal note (if not already exists)
    # Check if internal note already exists
    has_internal_note = any(
        msg.get("message_type") == "activity" and msg.get("private") 
        for msg in messages
    )
    
    if not has_internal_note and internal_note:
        if add_private_note(conversation_id, internal_note):
            print(f"  Added internal notes")
            success_count += 1
    
    if success_count > 0:
        print(f"  Successfully updated conversation {conversation_id}")
        return True
    else:
        print(f"  No updates applied to conversation {conversation_id}")
        return False

def main():
    """Main update function."""
    print("=" * 60)
    print("Update Existing Chatwoot Conversations")
    print("=" * 60)
    print(f"Chatwoot API URL: {CHATWOOT_API_URL}")
    print(f"Account ID: {CHATWOOT_ACCOUNT_ID}")
    print("=" * 60)
    
    # Get all conversations
    conversations = get_all_conversations()
    
    if not conversations:
        print("\nNo conversations found to update.")
        return
    
    print(f"\nUpdating {len(conversations)} conversations with improved format...")
    print("This will add:")
    print("  - TL;DR summary")
    print("  - Improved conversation message")
    print("  - Normalized labels")
    print("  - Updated custom attributes")
    print("  - Internal notes (if missing)")
    print()
    
    updated_count = 0
    skipped_count = 0
    
    for conv in conversations:
        if update_conversation(conv):
            updated_count += 1
        else:
            skipped_count += 1
    
    print("\n" + "=" * 60)
    print("Update Complete!")
    print(f"  Updated: {updated_count}")
    print(f"  Skipped: {skipped_count}")
    print("=" * 60)
    print(f"\nView updated conversations at:")
    print(f"  {CHATWOOT_API_URL.replace('/api/v1', '')}/app/accounts/{CHATWOOT_ACCOUNT_ID}/conversations")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Migrate Chatwoot data from hosted instance to local instance.

This script exports conversations and contacts from the hosted Chatwoot
and imports them into your local Chatwoot instance.
"""

import os
import json
import requests
from dotenv import load_dotenv
from typing import Dict, List, Optional

load_dotenv()

# Hosted instance (source)
HOSTED_API_URL = "https://app.chatwoot.com/api/v1"
HOSTED_ACCOUNT_ID = "151194"
HOSTED_API_TOKEN = "xYv4RX9B1rU8GsrNTQYCtHp6"

# Local instance (destination)
LOCAL_API_URL = "http://localhost:3001/api/v1"
LOCAL_ACCOUNT_ID = os.environ.get("CHATWOOT_ACCOUNT_ID", "3")
LOCAL_API_TOKEN = os.environ.get("CHATWOOT_API_TOKEN", "nD1pXhQMtMxV151Yxrn4yWJV")
LOCAL_INBOX_ID = os.environ.get("CHATWOOT_INBOX_ID", "1")

def get_headers(api_token: str) -> Dict:
    """Get API headers."""
    return {
        "api_access_token": api_token,
        "Content-Type": "application/json"
    }

def export_contacts(source_url: str, account_id: str, api_token: str) -> List[Dict]:
    """Export all contacts from source."""
    print(f"\nExporting contacts from hosted instance...")
    headers = get_headers(api_token)
    contacts = []
    page = 1
    
    while True:
        try:
            response = requests.get(
                f"{source_url}/accounts/{account_id}/contacts",
                headers=headers,
                params={"page": page},
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            # Handle different response formats
            if isinstance(data, dict) and "payload" in data:
                page_contacts = data["payload"]
            elif isinstance(data, list):
                page_contacts = data
            else:
                break
            
            if not page_contacts:
                break
            
            contacts.extend(page_contacts)
            print(f"  Exported {len(page_contacts)} contacts (page {page}, total: {len(contacts)})")
            page += 1
            
            # Safety limit
            if page > 50:
                break
                
        except Exception as e:
            print(f"  Error fetching page {page}: {e}")
            break
    
    print(f"Total contacts exported: {len(contacts)}")
    return contacts

def export_conversations(source_url: str, account_id: str, api_token: str) -> List[Dict]:
    """Export all conversations from source."""
    print(f"\nExporting conversations from hosted instance...")
    headers = get_headers(api_token)
    conversations = []
    page = 1
    
    while True:
        try:
            response = requests.get(
                f"{source_url}/accounts/{account_id}/conversations",
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
            print(f"  Exported {len(page_conversations)} conversations (page {page}, total: {len(conversations)})")
            page += 1
            
            # Safety limit
            if page > 50:
                break
                
        except Exception as e:
            print(f"  Error fetching page {page}: {e}")
            break
    
    print(f"Total conversations exported: {len(conversations)}")
    return conversations

def get_conversation_messages(source_url: str, account_id: str, conversation_id: int, api_token: str) -> List[Dict]:
    """Get all messages for a conversation."""
    try:
        headers = get_headers(api_token)
        response = requests.get(
            f"{source_url}/accounts/{account_id}/conversations/{conversation_id}/messages",
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
        print(f"    Warning: Could not fetch messages for conversation {conversation_id}: {e}")
        return []

def create_contact_local(contact_data: Dict, dest_url: str, account_id: str, api_token: str) -> Optional[Dict]:
    """Create contact in local instance."""
    headers = get_headers(api_token)
    
    # Prepare contact data
    contact_payload = {
        "name": contact_data.get("name", "Call Customer"),
        "identifier": contact_data.get("identifier") or contact_data.get("phone_number") or f"contact-{contact_data.get('id')}"
    }
    
    if contact_data.get("phone_number"):
        contact_payload["phone_number"] = contact_data["phone_number"]
    if contact_data.get("email"):
        contact_payload["email"] = contact_data["email"]
    
    try:
        response = requests.post(
            f"{dest_url}/accounts/{account_id}/contacts",
            json=contact_payload,
            headers=headers,
            timeout=30
        )
        
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 422:
            # Contact might already exist, try to find it
            error_data = response.json()
            if "identifier" in str(error_data.get("message", "")).lower():
                # Try to search for existing contact
                search_response = requests.get(
                    f"{dest_url}/accounts/{account_id}/contacts/search",
                    headers=headers,
                    params={"q": contact_payload["identifier"]},
                    timeout=30
                )
                if search_response.status_code == 200:
                    existing = search_response.json()
                    if existing and len(existing) > 0:
                        if isinstance(existing, dict) and "payload" in existing:
                            existing = existing["payload"]
                        return existing[0] if isinstance(existing, list) else existing
            return None
        else:
            print(f"    Error creating contact: {response.status_code} - {response.text[:100]}")
            return None
    except Exception as e:
        print(f"    Error creating contact: {e}")
        return None

def create_conversation_local(conversation_data: Dict, contact_id: int, source_id: str, 
                              dest_url: str, account_id: str, inbox_id: str, api_token: str) -> Optional[Dict]:
    """Create conversation in local instance."""
    headers = get_headers(api_token)
    
    conversation_payload = {
        "source_id": source_id,
        "inbox_id": int(inbox_id),
        "contact_id": contact_id
    }
    
    try:
        response = requests.post(
            f"{dest_url}/accounts/{account_id}/conversations",
            json=conversation_payload,
            headers=headers,
            timeout=30
        )
        
        if response.status_code == 200:
            return response.json()
        else:
            print(f"    Error creating conversation: {response.status_code} - {response.text[:100]}")
            return None
    except Exception as e:
        print(f"    Error creating conversation: {e}")
        return None

def add_message_local(message_data: Dict, dest_url: str, account_id: str, conversation_id: int, api_token: str) -> bool:
    """Add message to conversation in local instance."""
    headers = get_headers(api_token)
    
    message_payload = {
        "content": message_data.get("content", ""),
        "message_type": message_data.get("message_type", "incoming")
    }
    
    if message_data.get("private"):
        message_payload["private"] = True
        message_payload["message_type"] = "activity"
    
    try:
        response = requests.post(
            f"{dest_url}/accounts/{account_id}/conversations/{conversation_id}/messages",
            json=message_payload,
            headers=headers,
            timeout=30
        )
        return response.status_code == 200
    except Exception:
        return False

def migrate_data():
    """Main migration function."""
    print("=" * 60)
    print("Chatwoot Data Migration")
    print("=" * 60)
    print(f"Source: {HOSTED_API_URL} (Account {HOSTED_ACCOUNT_ID})")
    print(f"Destination: {LOCAL_API_URL} (Account {LOCAL_ACCOUNT_ID})")
    print("=" * 60)
    
    # Export contacts
    contacts = export_contacts(HOSTED_API_URL, HOSTED_ACCOUNT_ID, HOSTED_API_TOKEN)
    
    # Export conversations
    conversations = export_conversations(HOSTED_API_URL, HOSTED_ACCOUNT_ID, HOSTED_API_TOKEN)
    
    if not contacts and not conversations:
        print("\nNo data to migrate.")
        return
    
    print(f"\n{'=' * 60}")
    print("Importing to local instance...")
    print(f"{'=' * 60}")
    
    # Create contact mapping (hosted_id -> local_id)
    contact_map = {}
    
    # Import contacts
    print(f"\nImporting {len(contacts)} contacts...")
    imported_contacts = 0
    for contact in contacts:
        contact_id_hosted = contact.get("id")
        contact_name = contact.get("name", "Unknown")
        
        local_contact = create_contact_local(contact, LOCAL_API_URL, LOCAL_ACCOUNT_ID, LOCAL_API_TOKEN)
        if local_contact:
            local_id = local_contact.get("id")
            if local_id:
                contact_map[contact_id_hosted] = local_id
                imported_contacts += 1
                print(f"  ✓ Imported contact: {contact_name} (hosted: {contact_id_hosted} -> local: {local_id})")
            else:
                print(f"  ✗ Failed to import contact: {contact_name} (no local ID)")
        else:
            print(f"  ✗ Failed to import contact: {contact_name}")
    
    print(f"\nImported {imported_contacts} contacts")
    
    # Import conversations
    print(f"\nImporting {len(conversations)} conversations...")
    imported_conversations = 0
    
    for conv in conversations:
        conv_id_hosted = conv.get("id")
        contact_id_hosted = conv.get("meta", {}).get("sender", {}).get("id") or conv.get("contact", {}).get("id")
        
        if not contact_id_hosted:
            print(f"  ✗ Skipping conversation {conv_id_hosted}: No contact ID")
            continue
        
        local_contact_id = contact_map.get(contact_id_hosted)
        if not local_contact_id:
            print(f"  ✗ Skipping conversation {conv_id_hosted}: Contact {contact_id_hosted} not found locally")
            continue
        
        # Get contact's source_id
        try:
            headers = get_headers(LOCAL_API_TOKEN)
            contact_response = requests.get(
                f"{LOCAL_API_URL}/accounts/{LOCAL_ACCOUNT_ID}/contacts/{local_contact_id}",
                headers=headers,
                timeout=30
            )
            if contact_response.status_code == 200:
                local_contact_data = contact_response.json()
                source_id = local_contact_data.get("source_id") or local_contact_data.get("identifier")
            else:
                source_id = f"migrated-{conv_id_hosted}"
        except:
            source_id = f"migrated-{conv_id_hosted}"
        
        # Create conversation
        local_conv = create_conversation_local(
            conv, local_contact_id, source_id,
            LOCAL_API_URL, LOCAL_ACCOUNT_ID, LOCAL_INBOX_ID, LOCAL_API_TOKEN
        )
        
        if local_conv:
            local_conv_id = local_conv.get("id")
            imported_conversations += 1
            
            # Import messages
            messages = get_conversation_messages(HOSTED_API_URL, HOSTED_ACCOUNT_ID, conv_id_hosted, HOSTED_API_TOKEN)
            imported_messages = 0
            for msg in messages[:50]:  # Limit to first 50 messages
                if add_message_local(msg, LOCAL_API_URL, LOCAL_ACCOUNT_ID, local_conv_id, LOCAL_API_TOKEN):
                    imported_messages += 1
            
            print(f"  ✓ Imported conversation {conv_id_hosted} -> {local_conv_id} ({imported_messages} messages)")
        else:
            print(f"  ✗ Failed to import conversation {conv_id_hosted}")
    
    print(f"\n{'=' * 60}")
    print("Migration Complete!")
    print(f"  Contacts: {imported_contacts}/{len(contacts)}")
    print(f"  Conversations: {imported_conversations}/{len(conversations)}")
    print(f"{'=' * 60}")
    print(f"\nView your migrated data at:")
    print(f"  {LOCAL_API_URL.replace('/api/v1', '')}/app/accounts/{LOCAL_ACCOUNT_ID}/conversations")

if __name__ == "__main__":
    migrate_data()

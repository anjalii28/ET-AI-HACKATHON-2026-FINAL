#!/usr/bin/env python3
"""
Test priority filter with different value formats to see which works.
"""

import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

CHATWOOT_API_URL = os.environ.get("CHATWOOT_API_URL", "http://localhost:3001/api/v1")
CHATWOOT_API_TOKEN = os.environ.get("CHATWOOT_API_TOKEN")
CHATWOOT_ACCOUNT_ID = os.environ.get("CHATWOOT_ACCOUNT_ID", "3")

if not CHATWOOT_API_TOKEN:
    print("ERROR: CHATWOOT_API_TOKEN not found")
    exit(1)

def get_headers():
    return {
        "api_access_token": CHATWOOT_API_TOKEN,
        "Content-Type": "application/json"
    }

def test_priority_filter_format(priority_value, format_type="string"):
    """Test priority filter with different value formats."""
    headers = get_headers()
    
    if format_type == "string":
        # Format 1: String values
        values = [priority_value]
    elif format_type == "object":
        # Format 2: Object values (with id)
        values = [{"id": priority_value, "name": priority_value.capitalize()}]
    else:
        values = [priority_value]
    
    filter_payload = {
        "payload": [
            {
                "attribute_key": "priority",
                "attribute_model": "standard",
                "filter_operator": "equal_to",
                "values": values,
                "query_operator": None
            }
        ]
    }
    
    print(f"\n{'='*60}")
    print(f"Testing Priority Filter: '{priority_value}' (format: {format_type})")
    print(f"{'='*60}")
    print(f"Values format: {values}")
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/filter",
            json=filter_payload,
            headers=headers,
            params={"page": 1},
            timeout=30
        )
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            conversations = []
            
            if isinstance(data, dict):
                if "data" in data and isinstance(data["data"], dict) and "payload" in data["data"]:
                    conversations = data["data"]["payload"]
                elif "payload" in data:
                    conversations = data["payload"]
                elif "data" in data:
                    conversations = data["data"] if isinstance(data["data"], list) else []
            
            print(f"✅ Found {len(conversations)} conversations")
            if conversations:
                print(f"Sample IDs: {[c.get('id') for c in conversations[:5]]}")
                return True
            else:
                print("❌ No conversations found")
                return False
        else:
            print(f"❌ Error: {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ Exception: {e}")
        return False

def test_priority_with_inbox_filter(priority_value, inbox_id="1"):
    """Test priority filter combined with inbox_id filter."""
    headers = get_headers()
    
    filter_payload = {
        "payload": [
            {
                "attribute_key": "priority",
                "attribute_model": "standard",
                "filter_operator": "equal_to",
                "values": [priority_value],
                "query_operator": "and"
            },
            {
                "attribute_key": "inbox_id",
                "attribute_model": "standard",
                "filter_operator": "equal_to",
                "values": [inbox_id],
                "query_operator": None
            }
        ]
    }
    
    print(f"\n{'='*60}")
    print(f"Testing Priority + Inbox Filter")
    print(f"Priority: '{priority_value}', Inbox: '{inbox_id}'")
    print(f"{'='*60}")
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/filter",
            json=filter_payload,
            headers=headers,
            params={"page": 1},
            timeout=30
        )
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            conversations = []
            
            if isinstance(data, dict):
                if "data" in data and isinstance(data["data"], dict) and "payload" in data["data"]:
                    conversations = data["data"]["payload"]
                elif "payload" in data:
                    conversations = data["payload"]
                elif "data" in data:
                    conversations = data["data"] if isinstance(data["data"], list) else []
            
            print(f"✅ Found {len(conversations)} conversations")
            if conversations:
                print(f"Sample IDs: {[c.get('id') for c in conversations[:5]]}")
                # Check if they're in the right inbox
                for conv in conversations[:3]:
                    print(f"  Conversation {conv.get('id')}: inbox_id={conv.get('inbox_id')}, priority={conv.get('priority')}")
                return True
            else:
                print("❌ No conversations found")
                print("   This might mean:")
                print("   - No conversations with this priority in inbox 1")
                print("   - Filter format is wrong")
                return False
        else:
            print(f"❌ Error: {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ Exception: {e}")
        return False

def main():
    print("Priority Filter Format Test")
    print("="*60)
    print(f"API URL: {CHATWOOT_API_URL}")
    print(f"Account ID: {CHATWOOT_ACCOUNT_ID}")
    
    priorities = ["low", "medium", "high"]
    
    print("\n" + "="*60)
    print("TEST 1: Priority Filter Alone (String Format)")
    print("="*60)
    for priority in priorities:
        test_priority_filter_format(priority, "string")
    
    print("\n" + "="*60)
    print("TEST 2: Priority Filter Alone (Object Format)")
    print("="*60)
    for priority in priorities:
        test_priority_filter_format(priority, "object")
    
    print("\n" + "="*60)
    print("TEST 3: Priority + Inbox Filter (Like Your UI)")
    print("="*60)
    for priority in priorities:
        test_priority_with_inbox_filter(priority, "1")
    
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print("\n💡 Check which format returns conversations!")
    print("   This will tell us if:")
    print("   1. Filter format is wrong")
    print("   2. No conversations match the criteria")
    print("   3. Inbox filter is excluding conversations")

if __name__ == "__main__":
    main()

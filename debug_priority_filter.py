#!/usr/bin/env python3
"""
Debug script to test priority filtering via API.

This script tests the actual API filter endpoint that Chatwoot uses
to see if priority filtering works at the API level.
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
    print("ERROR: CHATWOOT_API_TOKEN not found in .env file")
    exit(1)

def get_headers():
    return {
        "api_access_token": CHATWOOT_API_TOKEN,
        "Content-Type": "application/json"
    }

def test_priority_filter_api(priority_value):
    """Test the filter API endpoint with priority filter."""
    headers = get_headers()
    
    # This is the format Chatwoot uses for filters
    filter_payload = {
        "payload": [
            {
                "attribute_key": "priority",
                "filter_operator": "equal_to",
                "values": [priority_value],
                "query_operator": None
            }
        ]
    }
    
    print(f"\n{'='*60}")
    print(f"Testing Priority Filter API: priority='{priority_value}'")
    print(f"{'='*60}")
    print(f"\nFilter Payload:")
    print(json.dumps(filter_payload, indent=2))
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/filter",
            json=filter_payload,
            headers=headers,
            params={"page": 1},
            timeout=30
        )
        
        print(f"\nResponse Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            # Handle different response formats
            conversations = []
            if isinstance(data, dict):
                if "data" in data and isinstance(data["data"], dict) and "payload" in data["data"]:
                    conversations = data["data"]["payload"]
                elif "payload" in data:
                    conversations = data["payload"]
                elif "data" in data:
                    conversations = data["data"] if isinstance(data["data"], list) else []
            
            print(f"\n✅ Found {len(conversations)} conversations with priority='{priority_value}'")
            
            if conversations:
                print(f"\nSample conversation IDs:")
                for conv in conversations[:5]:
                    conv_id = conv.get("id")
                    conv_priority = conv.get("priority")
                    print(f"  Conversation {conv_id}: priority='{conv_priority}'")
            else:
                print(f"\n⚠️  No conversations found!")
                print(f"   This might indicate:")
                print(f"   1. Filter format is incorrect")
                print(f"   2. API doesn't support priority filtering this way")
                print(f"   3. Conversations don't have priority set correctly")
            
            return conversations
        else:
            print(f"\n❌ Error: {response.status_code}")
            print(f"Response: {response.text}")
            return []
            
    except Exception as e:
        print(f"\n❌ Exception: {e}")
        import traceback
        traceback.print_exc()
        return []

def main():
    print("Priority Filter API Debug Script")
    print("="*60)
    print(f"API URL: {CHATWOOT_API_URL}")
    print(f"Account ID: {CHATWOOT_ACCOUNT_ID}")
    
    priorities = ["low", "medium", "high", "urgent"]
    
    results = {}
    for priority in priorities:
        conversations = test_priority_filter_api(priority)
        results[priority] = len(conversations)
    
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    print("\nFilter Results:")
    for priority, count in results.items():
        status = "✅" if count > 0 else "❌"
        print(f"  {status} {priority:8}: {count:3} conversations")
    
    total = sum(results.values())
    print(f"\nTotal filtered conversations: {total}")
    
    if total == 0:
        print("\n⚠️  WARNING: No conversations found with any priority filter!")
        print("   This suggests the filter API format might be incorrect.")
        print("   Check browser DevTools Network tab to see actual filter payload.")
    else:
        print("\n✅ Priority filtering works at API level!")
        print("   If UI filter doesn't work, it's likely a frontend issue.")

if __name__ == "__main__":
    main()

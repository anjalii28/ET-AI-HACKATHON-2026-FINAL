#!/usr/bin/env python3
"""
Check what filter requests are being made and test them directly.
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

def test_basic_conversations():
    """Test basic conversation fetch without filters."""
    print("\n" + "="*60)
    print("TEST 1: Basic Conversations (No Filter)")
    print("="*60)
    
    headers = get_headers()
    try:
        response = requests.get(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations",
            headers=headers,
            params={"page": 1, "status": "open"},
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
            
            print(f"Found {len(conversations)} conversations with status='open'")
            if conversations:
                print(f"Sample IDs: {[c.get('id') for c in conversations[:5]]}")
                print(f"Sample statuses: {[c.get('status') for c in conversations[:5]]}")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception: {e}")

def test_status_filter():
    """Test status filter via filter endpoint."""
    print("\n" + "="*60)
    print("TEST 2: Status Filter (via /filter endpoint)")
    print("="*60)
    
    headers = get_headers()
    filter_payload = {
        "payload": [
            {
                "attribute_key": "status",
                "filter_operator": "equal_to",
                "values": ["open"],
                "query_operator": None
            }
        ]
    }
    
    print(f"Filter Payload:")
    print(json.dumps(filter_payload, indent=2))
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/filter",
            json=filter_payload,
            headers=headers,
            params={"page": 1},
            timeout=30
        )
        print(f"\nStatus: {response.status_code}")
        
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
            
            print(f"Found {len(conversations)} conversations")
            if conversations:
                print(f"Sample IDs: {[c.get('id') for c in conversations[:5]]}")
                print(f"Sample statuses: {[c.get('status') for c in conversations[:5]]}")
            else:
                print("⚠️  No conversations found!")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception: {e}")

def test_priority_filter():
    """Test priority filter."""
    print("\n" + "="*60)
    print("TEST 3: Priority Filter (via /filter endpoint)")
    print("="*60)
    
    headers = get_headers()
    filter_payload = {
        "payload": [
            {
                "attribute_key": "priority",
                "filter_operator": "equal_to",
                "values": ["medium"],
                "query_operator": None
            }
        ]
    }
    
    print(f"Filter Payload:")
    print(json.dumps(filter_payload, indent=2))
    
    try:
        response = requests.post(
            f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations/filter",
            json=filter_payload,
            headers=headers,
            params={"page": 1},
            timeout=30
        )
        print(f"\nStatus: {response.status_code}")
        
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
            
            print(f"Found {len(conversations)} conversations")
            if conversations:
                print(f"Sample IDs: {[c.get('id') for c in conversations[:5]]}")
                print(f"Sample priorities: {[c.get('priority') for c in conversations[:5]]}")
            else:
                print("⚠️  No conversations found!")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Exception: {e}")

def main():
    print("Filter API Test Script")
    print("="*60)
    print(f"API URL: {CHATWOOT_API_URL}")
    print(f"Account ID: {CHATWOOT_ACCOUNT_ID}")
    
    test_basic_conversations()
    test_status_filter()
    test_priority_filter()
    
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print("\nIf all tests return 0 conversations, the issue might be:")
    print("1. Filter API format is wrong")
    print("2. Conversations don't match filter criteria")
    print("3. API endpoint requires different format")
    print("\nCheck browser DevTools Network tab to see actual requests being made.")

if __name__ == "__main__":
    main()

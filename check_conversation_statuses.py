#!/usr/bin/env python3
"""
Check what status values conversations actually have.
This helps debug why filters aren't working.
"""

import os
import json
import requests
from dotenv import load_dotenv
from collections import Counter

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

def get_all_conversations():
    """Get all conversations to check their statuses."""
    headers = get_headers()
    conversations = []
    page = 1
    
    print("Fetching all conversations...")
    
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
            page += 1
            
            if page > 10:  # Safety limit
                break
                
        except Exception as e:
            print(f"Error fetching page {page}: {e}")
            break
    
    return conversations

def main():
    print("="*60)
    print("Checking Conversation Statuses and Priorities")
    print("="*60)
    
    conversations = get_all_conversations()
    print(f"\nTotal conversations: {len(conversations)}")
    
    # Count statuses
    statuses = [c.get("status") for c in conversations]
    status_counts = Counter(statuses)
    
    print("\n" + "="*60)
    print("STATUS DISTRIBUTION")
    print("="*60)
    for status, count in status_counts.most_common():
        print(f"  {status or 'null':15}: {count:3} conversations")
    
    # Count priorities
    priorities = [c.get("priority") for c in conversations]
    priority_counts = Counter(priorities)
    
    print("\n" + "="*60)
    print("PRIORITY DISTRIBUTION")
    print("="*60)
    for priority, count in priority_counts.most_common():
        print(f"  {priority or 'null':15}: {count:3} conversations")
    
    # Show sample conversations
    print("\n" + "="*60)
    print("SAMPLE CONVERSATIONS")
    print("="*60)
    for conv in conversations[:10]:
        conv_id = conv.get("id")
        status = conv.get("status")
        priority = conv.get("priority")
        print(f"  Conversation {conv_id}: status='{status}', priority='{priority}'")
    
    # Key insights
    print("\n" + "="*60)
    print("KEY INSIGHTS")
    print("="*60)
    
    open_count = status_counts.get("open", 0)
    if open_count == 0:
        print("⚠️  NO conversations have status='open'!")
        print("   This is why 'open status' filter shows no results.")
        print(f"   Most common status: {status_counts.most_common(1)[0][0]}")
    else:
        print(f"✅ {open_count} conversations have status='open'")
        print("   'Open status' filter should work for these.")
    
    print("\n💡 TIP: When filtering, use the actual status values shown above!")

if __name__ == "__main__":
    main()

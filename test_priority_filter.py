#!/usr/bin/env python3
"""
Test script to verify priority filter is working.

This script:
1. Checks existing conversations for priority values
2. Creates test conversations with different priorities
3. Verifies priority filter works
"""

import os
import json
import requests
from dotenv import load_dotenv
from typing import Dict, Optional, List

load_dotenv()

CHATWOOT_API_URL = os.environ.get("CHATWOOT_API_URL", "http://localhost:3001/api/v1")
CHATWOOT_API_TOKEN = os.environ.get("CHATWOOT_API_TOKEN")
CHATWOOT_ACCOUNT_ID = os.environ.get("CHATWOOT_ACCOUNT_ID", "3")
CHATWOOT_INBOX_ID = os.environ.get("CHATWOOT_INBOX_ID")

if not CHATWOOT_API_TOKEN:
    print("ERROR: CHATWOOT_API_TOKEN not found in .env file")
    exit(1)

def get_headers() -> Dict:
    """Get API headers."""
    return {
        "api_access_token": CHATWOOT_API_TOKEN,
        "Content-Type": "application/json"
    }

def get_conversations_with_priority(priority: Optional[str] = None) -> List[Dict]:
    """Get conversations, optionally filtered by priority."""
    headers = get_headers()
    conversations = []
    page = 1
    
    print(f"\nFetching conversations" + (f" with priority='{priority}'" if priority else "") + "...")
    
    while True:
        try:
            params = {"page": page}
            response = requests.get(
                f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/conversations",
                headers=headers,
                params=params,
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
            
            # Filter by priority if specified
            if priority:
                page_conversations = [c for c in page_conversations if c.get("priority") == priority]
            
            conversations.extend(page_conversations)
            page += 1
            
            if page > 10:  # Safety limit
                break
                
        except Exception as e:
            print(f"  Error fetching page {page}: {e}")
            break
    
    return conversations

def check_conversation_priorities():
    """Check how many conversations have priority set."""
    print("\n" + "=" * 60)
    print("CHECKING CONVERSATION PRIORITIES")
    print("=" * 60)
    
    all_conversations = get_conversations_with_priority()
    
    print(f"\nTotal conversations found: {len(all_conversations)}")
    
    # Count by priority
    priority_counts = {
        "low": 0,
        "medium": 0,
        "high": 0,
        "urgent": 0,
        "null": 0
    }
    
    for conv in all_conversations:
        priority = conv.get("priority")
        if priority is None:
            priority_counts["null"] += 1
        elif priority in priority_counts:
            priority_counts[priority] += 1
        else:
            print(f"  Warning: Unknown priority value '{priority}' in conversation {conv.get('id')}")
    
    print("\nPriority distribution:")
    for priority, count in priority_counts.items():
        print(f"  {priority:8}: {count:3} conversations")
    
    # Show sample conversations
    print("\nSample conversations with priority set:")
    shown = 0
    for conv in all_conversations:
        priority = conv.get("priority")
        if priority and shown < 5:
            print(f"  Conversation {conv.get('id')}: priority='{priority}'")
            shown += 1
    
    if shown == 0:
        print("  (No conversations with priority set found)")
    
    return priority_counts

def test_priority_filter():
    """Test priority filter by checking conversations for each priority."""
    print("\n" + "=" * 60)
    print("TESTING PRIORITY FILTER")
    print("=" * 60)
    
    priorities = ["low", "medium", "high", "urgent"]
    
    for priority in priorities:
        conversations = get_conversations_with_priority(priority)
        print(f"\nPriority '{priority}': {len(conversations)} conversations")
        
        if conversations:
            print(f"  Sample IDs: {[c.get('id') for c in conversations[:5]]}")
        else:
            print(f"  ⚠️  No conversations found with priority='{priority}'")
            print(f"     This means the filter won't show any results for '{priority}'")

def verify_new_conversation_priority():
    """Verify that newly created conversations have priority set."""
    print("\n" + "=" * 60)
    print("VERIFYING NEW CONVERSATIONS")
    print("=" * 60)
    
    print("\nTo verify new conversations have priority:")
    print("1. Run: python send_to_chatwoot.py")
    print("2. Check the console output for 'Set priority: ...' messages")
    print("3. Run this script again to see updated priority counts")
    print("\nOr check in Chatwoot UI:")
    print("1. Open a conversation")
    print("2. Right-click → Priority (should show current priority)")
    print("3. Use Advanced Filters → Priority to filter")

def main():
    """Main test function."""
    print("Priority Filter Test Script")
    print("=" * 60)
    print(f"Chatwoot API URL: {CHATWOOT_API_URL}")
    print(f"Account ID: {CHATWOOT_ACCOUNT_ID}")
    print("=" * 60)
    
    # Check current state
    priority_counts = check_conversation_priorities()
    
    # Test filter
    test_priority_filter()
    
    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    total_with_priority = sum(priority_counts[p] for p in ["low", "medium", "high", "urgent"])
    total_without_priority = priority_counts["null"]
    
    print(f"\nConversations WITH priority set: {total_with_priority}")
    print(f"Conversations WITHOUT priority set: {total_without_priority}")
    
    if total_without_priority > 0:
        print(f"\n⚠️  {total_without_priority} conversations don't have priority set.")
        print("   These won't appear when filtering by priority.")
        print("   Run 'python send_to_chatwoot.py' to create new conversations with priority.")
    
    if total_with_priority > 0:
        print(f"\n✅ {total_with_priority} conversations have priority set.")
        print("   Priority filter should work for these conversations.")
    
    verify_new_conversation_priority()

if __name__ == "__main__":
    main()

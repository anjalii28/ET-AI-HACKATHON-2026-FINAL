#!/usr/bin/env python3
"""
Helper script to get your Chatwoot Inbox ID.

This script lists all inboxes in your Chatwoot account and shows their numeric IDs.
You need your API Access Token to run this.
"""

import os
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

CHATWOOT_API_URL = os.environ.get("CHATWOOT_API_URL", "https://app.chatwoot.com/api/v1")
CHATWOOT_ACCOUNT_ID = os.environ.get("CHATWOOT_ACCOUNT_ID", "151194")
CHATWOOT_API_TOKEN = os.environ.get("CHATWOOT_API_TOKEN")

if not CHATWOOT_API_TOKEN:
    print("ERROR: CHATWOOT_API_TOKEN not found in .env file")
    print("\nTo get your API token:")
    print("1. Log into Chatwoot: http://localhost:3000")
    print("2. Click your Profile (avatar)")
    print("3. Go to API Tokens section")
    print("4. Generate New Token")
    print("5. Add to .env: CHATWOOT_API_TOKEN=your-token-here")
    exit(1)

print("Fetching inboxes from Chatwoot...")
print(f"Account ID: {CHATWOOT_ACCOUNT_ID}")
print(f"API URL: {CHATWOOT_API_URL}\n")

headers = {
    "api_access_token": CHATWOOT_API_TOKEN,
    "Content-Type": "application/json"
}

try:
    response = requests.get(
        f"{CHATWOOT_API_URL}/accounts/{CHATWOOT_ACCOUNT_ID}/inboxes",
        headers=headers,
        timeout=10
    )
    response.raise_for_status()
    
    response_data = response.json()
    
    # Handle different response formats
    if isinstance(response_data, dict) and "payload" in response_data:
        inboxes = response_data["payload"]
    elif isinstance(response_data, list):
        inboxes = response_data
    else:
        inboxes = []
    
    if not inboxes:
        print("No inboxes found in your account.")
        print("Create an inbox first: Settings → Inboxes → Add Inbox → API")
        exit(0)
    
    print("=" * 60)
    print("Your Chatwoot Inboxes:")
    print("=" * 60)
    
    for inbox in inboxes:
        if isinstance(inbox, str):
            continue  # Skip if not a dict
        inbox_id = inbox.get("id")
        name = inbox.get("name", "Unnamed")
        channel_type = inbox.get("channel_type", "unknown")
        status = inbox.get("status", "unknown")
        
        print(f"\n📧 {name}")
        print(f"   ID: {inbox_id} ← Use this for CHATWOOT_INBOX_ID")
        print(f"   Type: {channel_type}")
        print(f"   Status: {status}")
        
        if channel_type == "api":
            identifier = inbox.get("identifier")
            if identifier:
                print(f"   Identifier: {identifier} (for Client API)")
    
    print("\n" + "=" * 60)
    print("Copy the ID number (not the identifier) to your .env file:")
    print("CHATWOOT_INBOX_ID=<id-number>")
    print("=" * 60)
    
except requests.exceptions.RequestException as e:
    print(f"ERROR: Could not fetch inboxes")
    print(f"   {e}")
    if hasattr(e, 'response') and e.response is not None:
        print(f"   Status Code: {e.response.status_code}")
        print(f"   Response: {e.response.text}")
    print("\nTroubleshooting:")
    print("- Verify CHATWOOT_API_TOKEN is correct")
    print("- Check Chatwoot is running: http://localhost:3001")
    print("- Verify CHATWOOT_ACCOUNT_ID is correct")

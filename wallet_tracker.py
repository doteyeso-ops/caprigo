import time
import json
from datetime import datetime

# Track connected wallets
connected_wallets = {}

def check_connection(wallet_id):
    """Simulate checking wallet connection status"""
    # In production, this would call actual wallet APIs
    return connected_wallets.get(wallet_id, False)

def log_status(action, wallet_id, status=None):
    """Log wallet status to file with timestamp"""
    timestamp = datetime.now().isoformat()
    log_entry = {
        "timestamp": timestamp,
        "action": action,
        "wallet_id": wallet_id,
        "status": status
    }
    with open("wallet_status.log", "a") as f:
        f.write(json.dumps(log_entry) + "\n")

def add_wallet(wallet_id, initial_status=True):
    """Add a wallet to tracking"""
    connected_wallets[wallet_id] = initial_status
    log_status("Wallet Added", wallet_id, initial_status)
    print(f"Added wallet: {wallet_id} (status: {initial_status})")

def remove_wallet(wallet_id):
    """Remove a wallet from tracking"""
    if wallet_id in connected_wallets:
        del connected_wallets[wallet_id]
        log_status("Wallet Removed", wallet_id)
        print(f"Removed wallet: {wallet_id}")

def monitor_wallets(interval=60):
    """Monitor all tracked wallets"""
    print(f"Starting wallet monitor (check interval: {interval}s)")
    print("Press Ctrl+C to stop")
    
    try:
        while True:
            for wallet_id in list(connected_wallets.keys()):
                # In production: replace with actual API call
                status = check_connection(wallet_id)
                connected_wallets[wallet_id] = status
                log_status("Connection Check", wallet_id, status)
                print(f"[{datetime.now().strftime('%H:%M:%S')}] {wallet_id}: {'Connected' if status else 'Disconnected'}")
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nMonitoring stopped by user")
        log_status("Monitor Stopped", "system")

if __name__ == "__main__":
    # Demo: add some test wallets
    add_wallet("wallet_001", True)
    add_wallet("wallet_002", False)
    add_wallet("wallet_003", True)
    
    # Start monitoring
    monitor_wallets(interval=10)  # Check every 10 seconds for demo
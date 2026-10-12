"""Forward newline-delimited robot JSON to RedRoute; Python standard library only.

This transports measured data, not a simulator or ROS navigation controller.
Your ROS/sensor adapter must emit the documented telemetry schema on stdout.
"""
import json
import os
import sys
import urllib.error
import urllib.request


def main():
    endpoint = os.environ.get("REDROUTE_URL", "http://127.0.0.1:3000").rstrip("/") + "/api/telemetry"
    token = os.environ.get("TELEMETRY_TOKEN", "local-prototype-token")
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            packet = json.loads(line)
            request = urllib.request.Request(endpoint, data=json.dumps(packet).encode("utf-8"), headers={"Content-Type": "application/json", "Authorization": "Bearer " + token}, method="POST")
            with urllib.request.urlopen(request, timeout=5) as response:
                print(response.read().decode("utf-8"), flush=True)
        except urllib.error.HTTPError as error:
            print("Rejected telemetry: " + error.read().decode("utf-8"), file=sys.stderr, flush=True)
        except (ValueError, OSError) as error:
            print("Telemetry not sent: " + str(error), file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
